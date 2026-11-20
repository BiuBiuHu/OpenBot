import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[1] / 'runtime/openhands/install.py')
i = importlib.util.module_from_spec(spec)
spec.loader.exec_module(i)

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.calls = []
        self.patchers = [patch.object(i, 'ROOT', self.root), patch.object(i, 'UNIT', self.root / 'service'),
            patch.object(i.subprocess, 'run', return_value=SimpleNamespace(returncode=0)),
            patch.object(i.shutil, 'disk_usage', return_value=SimpleNamespace(free=4*1024**3)),
            patch.object(i, 'wait_health'), patch.object(i, 'verify_execution'), patch.object(i, 'run', side_effect=self.fake_run)]
        for p in self.patchers: p.start()
    def tearDown(self):
        for p in reversed(self.patchers): p.stop()
        self.tmp.cleanup()
    def fake_run(self, *args):
        self.calls.append(args)
        if '-m' in args and 'venv' in args:
            Path(args[-1]).mkdir()
    def test_first_install_repeat_preserves_token_and_does_not_restart(self):
        first = i.install_locked('lock-v1')
        self.assertTrue(first['changed'])
        self.assertEqual((self.root/'engine.env').stat().st_mode & 0o777, 0o600)
        self.calls.clear()
        second = i.install_locked('lock-v1')
        self.assertEqual(first['sessionApiKey'], second['sessionApiKey'])
        self.assertFalse(second['changed'])
        self.assertFalse(any('restart' in c or ('install' in c and c[0].endswith('/pip')) for c in self.calls))
    def test_failed_upgrade_restores_old_release_and_unit(self):
        i.install_locked('lock-v1')
        old = (self.root/'current').readlink()
        unit = (self.root/'service').read_text()
        with patch.object(i, 'wait_health', side_effect=RuntimeError('not healthy')):
            with self.assertRaisesRegex(RuntimeError, 'not healthy'): i.install_locked('lock-v2')
        self.assertEqual((self.root/'current').readlink(), old)
        self.assertEqual((self.root/'service').read_text(), unit)
    def test_failed_first_file_smoke_removes_active_service(self):
        with patch.object(i, 'verify_execution', side_effect=RuntimeError('file smoke failed')):
            with self.assertRaisesRegex(RuntimeError, 'file smoke failed'): i.install_locked('lock-v1')
        self.assertFalse((self.root/'current').exists())
        self.assertFalse((self.root/'service').exists())

    def test_dependency_failure_keeps_current_service(self):
        i.install_locked('lock-v1')
        old = (self.root/'current').readlink()
        def fail(*args):
            if 'install' in args: raise RuntimeError('download failed')
            self.fake_run(*args)
        with patch.object(i, 'run', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'download failed'): i.install_locked('lock-v2')
        self.assertEqual((self.root/'current').readlink(), old)

if __name__ == '__main__': unittest.main()
