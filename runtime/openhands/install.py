#!/usr/bin/env python3
"""OpenBot-owned engine installer. Stdout is a machine-only credential channel."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request

VERSION = '1.49.2'
PORT = 18000
ROOT = Path('/opt/openbot-engine')
UNIT = Path('/etc/systemd/system/openbot-engine.service')
USER = 'openbot-engine'

def run(*args):
    fd = os.open(ROOT / 'install.log', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, 'a') as log:
        subprocess.run(args, check=True, stdout=log, stderr=log,
                   env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive', 'PIP_NO_INPUT': '1'})

def supported():
    release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    return release.get('ID', '').strip('"') == 'ubuntu' and release.get('VERSION_ID', '').strip('"') == '24.04' and platform.machine() == 'x86_64'

def health(token):
    try:
        req = urllib.request.Request(f'http://127.0.0.1:{PORT}/health', headers={'X-Session-API-Key': token})
        with urllib.request.urlopen(req, timeout=2) as response:
            return response.status == 200 and json.load(response).get('status') == 'ok'
    except Exception:
        return False

def wait_health(token):
    for _ in range(60):
        if health(token):
            return
        time.sleep(1)
    raise RuntimeError('服务未能在 60 秒内就绪；请检查 journalctl -u openbot-engine，修复后重试。')

def install(lock):
    if os.geteuid() != 0:
        raise RuntimeError('安装需要 root 或免密 sudo。请为连接账户配置权限后重试。')
    if not supported():
        raise RuntimeError('自动安装目前支持 Ubuntu 24.04 x86_64；未修改此主机。')
    if not Path('/run/systemd/system').exists():
        raise RuntimeError('此主机未运行 systemd，无法托管长期服务。')
    ROOT.mkdir(mode=0o755, parents=True, exist_ok=True)
    with (ROOT / 'install.lock').open('w') as guard:
        try:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('此主机已有安装正在进行，请稍后重试。')
        return install_locked(lock)

def install_locked(lock):
    digest = hashlib.sha256(lock.encode()).hexdigest()
    release = ROOT / ('release-' + digest[:16])
    current = ROOT / 'current'
    old = os.readlink(current) if current.is_symlink() else None
    env_file = ROOT / 'engine.env'
    # Refuse unrelated listeners instead of killing or replacing them.
    import socket
    active = subprocess.run(['systemctl', 'is-active', '--quiet', 'openbot-engine']).returncode == 0
    if not active:
        with socket.socket() as sock:
            try:
                sock.bind(('127.0.0.1', PORT))
            except OSError:
                raise RuntimeError('端口 18000 已被其他服务使用；未停止或覆盖它，请先解决端口冲突。')
    if shutil.disk_usage(ROOT).free < 2 * 1024**3:
        raise RuntimeError('安装需要至少 2 GiB 可用磁盘空间。')
    if not Path('/usr/bin/python3.12').exists() or not Path('/usr/lib/python3.12/ensurepip').exists():
        run('apt-get', 'update')
        run('apt-get', 'install', '-y', 'python3.12', 'python3.12-venv', 'ca-certificates')
    if subprocess.run(['id', '-u', USER], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        run('useradd', '--system', '--create-home', '--home-dir', '/var/lib/openbot-engine', '--shell', '/bin/bash', USER)
    run('install', '-d', '-o', USER, '-g', USER, '-m', '700', '/var/lib/openbot-engine/workspace')
    if not env_file.exists():
        fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write('OH_SESSION_API_KEYS_0=' + secrets.token_hex(32) + '\nOH_SECRET_KEY=' + secrets.token_hex(32) + '\n')
    os.chmod(env_file, 0o600)
    token = dict(line.split('=', 1) for line in env_file.read_text().splitlines())['OH_SESSION_API_KEYS_0']
    if not (release / 'ready').exists():
        if old == str(release):
            raise RuntimeError('当前安装缺少完整性标记，请检查服务，未覆盖正在使用的目录。')
        if release.exists():
            shutil.rmtree(release)
        run('/usr/bin/python3.12', '-m', 'venv', str(release))
        (release / 'requirements.lock').write_text(lock)
        # Both sources must satisfy the same version and SHA-256 lock. Never use host pip config.
        for index in ['https://mirrors.aliyun.com/pypi/simple/', 'https://pypi.org/simple']:
            try:
                run(str(release / 'bin/pip'), '--isolated', 'install', '--index-url', index, '--retries', '1', '--timeout', '15', '--require-hashes', '-r', str(release / 'requirements.lock'))
                break
            except subprocess.CalledProcessError:
                if index == 'https://pypi.org/simple':
                    raise

        run(str(release / 'bin/pip'), 'check')
        run(str(release / 'bin/python'), '-c', "from importlib.metadata import version; assert all(version(p)=='1.49.2' for p in ['openhands-agent-server','openhands-sdk','openhands-tools','openhands-workspace']); import openhands.agent_server")
        (release / 'ready').write_text(digest)
    run(str(release / 'bin/python'), '-c', "from importlib.metadata import version; assert all(version(p)=='1.49.2' for p in ['openhands-agent-server','openhands-sdk','openhands-tools','openhands-workspace'])")
    if (release / 'ready').read_text() != digest:
        raise RuntimeError('依赖锁校验失败，未启动服务。')
    unit = f'''[Unit]
Description=OpenBot managed OpenHands {VERSION}
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User={USER}
Group={USER}
StateDirectory=openbot-engine
WorkingDirectory=/var/lib/openbot-engine
Environment=HOME=/var/lib/openbot-engine
EnvironmentFile={env_file}
ExecStart={current}/bin/python -m openhands.agent_server --host 127.0.0.1 --port {PORT}
Restart=on-failure
RestartSec=5
UMask=0077
[Install]
WantedBy=multi-user.target
'''
    old_unit = UNIT.read_text() if UNIT.exists() else None
    changed = old != str(release) or old_unit != unit
    try:
        if changed:
            staging = ROOT / 'current.next'
            staging.unlink(missing_ok=True)
            staging.symlink_to(release)
            staging.replace(current)
            UNIT.write_text(unit)
            run('systemctl', 'daemon-reload')
            run('systemctl', 'enable', 'openbot-engine')
            run('systemctl', 'restart', 'openbot-engine')
        elif not active:
            run('systemctl', 'start', 'openbot-engine')
        wait_health(token)
    except Exception:
        if changed:
            run('systemctl', 'stop', 'openbot-engine')
            current.unlink(missing_ok=True)
            if old:
                current.symlink_to(old)
            if old_unit is not None:
                UNIT.write_text(old_unit)
            else:
                run('systemctl', 'disable', 'openbot-engine')
                UNIT.unlink(missing_ok=True)
            run('systemctl', 'daemon-reload')
            if old and old_unit:
                run('systemctl', 'start', 'openbot-engine')
        raise
    return {'version': VERSION, 'port': PORT, 'sessionApiKey': token, 'changed': changed, 'lockSha256': digest}

if __name__ == '__main__':
    try:
        payload = json.load(sys.stdin)
        print(json.dumps(install(payload['lock'])))
    except Exception as error:
        message = str(error) if isinstance(error, RuntimeError) else '安装失败：请检查网络、磁盘和系统依赖后重试；已有连接配置未更改。'
        print(json.dumps({'error': message}))
        sys.exit(1)
