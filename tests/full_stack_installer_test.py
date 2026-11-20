import base64,hashlib,importlib.util,io,json,os,tarfile,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stack_installer',root/'runtime/openhands/install.py')
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i)
exec(compile((root/'runtime/desktop/install.py').read_text(),'desktop/install.py','exec'),i.__dict__)

class FullStackTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.state=self.root/'state';self.state.mkdir();self.units=self.root/'units';self.units.mkdir();self.calls=[]
  buf=io.BytesIO()
  with tarfile.open(fileobj=buf,mode='w:gz') as tar:
   data=json.dumps({'sourceCommit':'test-commit'}).encode();entry=tarfile.TarInfo('package.json');entry.size=len(data);tar.addfile(entry,io.BytesIO(data))
  blob=buf.getvalue();self.payload={'model':{'name':'test/model','apiKey':'secret-test-key'},'assets':{'node':{'version':'22'},'chromium':{'version':'158'}},'runtime':{'archive':base64.b64encode(blob).decode(),'sha256':hashlib.sha256(blob).hexdigest(),'sourceCommit':'test-commit'},'browserProbe':'test'}
  self.patchers=[patch.object(i,'ROOT',self.root),patch.object(i,'STATE',self.state),patch.object(i,'UNITS',self.units),patch.object(i,'run',side_effect=self.fake_run),patch.object(i,'download_asset',side_effect=self.download),patch.object(i.subprocess,'run',return_value=SimpleNamespace(returncode=0)),patch.object(i.shutil,'disk_usage',return_value=SimpleNamespace(free=4*1024**3)),patch.object(i.os,'chown'),patch.object(i.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),patch.object(i,'wait_stack',return_value={'instanceId':'test-instance'}),patch.object(i,'verify_execution')]
  for p in self.patchers:p.start()
 def tearDown(self):
  for p in reversed(self.patchers):p.stop()
  self.temp.cleanup()
 def fake_run(self,*args):
  self.calls.append(args)
  if args[0]=='install' and '-d' in args:Path(args[-1]).mkdir(parents=True,exist_ok=True)
 def download(self,name,item):
  dest=self.root/'assets'/name;dest.mkdir(parents=True,exist_ok=True)
  if name=='chromium':
   (dest/'chrome-linux64').mkdir(exist_ok=True);(dest/'chrome-linux64/chrome_sandbox').touch()
  return dest
 def install(self):return i.install_stack_locked(self.payload,{'sessionApiKey':'test-session'})
 def test_initialization_repeat_preserves_credentials_and_units(self):
  first=self.install();self.calls.clear();second=self.install()
  self.assertTrue(first['stack']['changed']);self.assertFalse(second['stack']['changed'])
  self.assertEqual(first['stack']['token'],second['stack']['token']);self.assertFalse(any('restart' in c for c in self.calls))
  self.assertIn('User=openbot-engine',(self.units/'openbot-runtime.service').read_text())
  self.assertNotIn('secret-test-key',(self.units/'openbot-runtime.service').read_text())
  self.assertEqual((self.root/'runtime.env').stat().st_mode & 0o777,0o600)
 def test_busy_task_blocks_before_package_changes(self):
  (self.state/'runtime').mkdir();(self.state/'runtime/task.json').write_text(json.dumps({'status':'running'}))
  with self.assertRaisesRegex(RuntimeError,'未结束任务'):self.install()
  self.assertEqual(self.calls,[])
 def test_service_failure_rolls_back_configuration(self):
  self.install();before=(self.root/'runtime.env').read_text();old=(self.units/'openbot-runtime.service').read_text()
  self.payload['model']['apiKey']='replacement-key'
  with patch.object(i,'wait_stack',side_effect=RuntimeError('unhealthy')):
   with self.assertRaisesRegex(RuntimeError,'unhealthy'):self.install()
  self.assertEqual((self.root/'runtime.env').read_text(),before);self.assertEqual((self.units/'openbot-runtime.service').read_text(),old)
 def test_runtime_tampering_refused_before_service_activation(self):
  self.payload['runtime']['sha256']='0'*64
  with self.assertRaisesRegex(RuntimeError,'校验失败'):self.install()
  self.assertFalse(any('restart' in c for c in self.calls))

if __name__=='__main__':unittest.main()
