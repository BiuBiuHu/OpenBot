# Composed with runtime/openhands/install.py by the local installer.
import base64
import io
import tarfile
import zipfile
import socket
import pwd

STACK_PORTS = {'runtime': 13850, 'cdp': 19322, 'vnc': 15901, 'desktop': 16080}
STATE = Path('/var/lib/openbot-engine')
UNITS = Path('/etc/systemd/system')

def download_asset(name, item):
    cache = ROOT / 'downloads'
    cache.mkdir(exist_ok=True)
    target = cache / (name + '-' + item['version'] + ('.zip' if name == 'chromium' else '.tar.xz'))
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != item['sha256']:
        partial = target.with_suffix('.partial')
        # Mirrors provide the identical upstream binary; the pinned hash is mandatory.
        mirrors = [item['url']]
        if name == 'chromium':
            mirrors.insert(0, f"https://cdn.npmmirror.com/binaries/chrome-for-testing/{item['version']}/linux64/chrome-linux64.zip")
        else:
            mirrors.insert(0, f"https://npmmirror.com/mirrors/node/v{item['version']}/node-v{item['version']}-linux-x64.tar.xz")
        for url in mirrors:
            try:
                run('curl', '--fail', '--location', '--max-time', '240', '--retry', '1', '--output', str(partial), url)
                if hashlib.sha256(partial.read_bytes()).hexdigest() != item['sha256']:
                    raise RuntimeError('下载文件哈希不匹配，拒绝安装。')
                partial.replace(target)
                break
            except Exception:
                partial.unlink(missing_ok=True)
                if url == mirrors[-1]: raise
    directory = ROOT / 'assets' / (name + '-' + item['version'])
    if not (directory / '.ready').exists():
        directory.mkdir(parents=True, exist_ok=True)
        if name == 'chromium':
            with zipfile.ZipFile(target) as archive:
                archive.extractall(directory)
                for entry in archive.infolist():
                    mode = entry.external_attr >> 16
                    if mode: os.chmod(directory / entry.filename, mode & 0o777)
        else:
            with tarfile.open(target) as archive: archive.extractall(directory, filter='data')
        (directory / '.ready').write_text(item['sha256'])
    return directory

def request_json(url, token=None):
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=5) as r:
        return json.load(r)

def wait_stack(token):
    for _ in range(60):
        try:
            identity = request_json('http://127.0.0.1:13850/v1/identity', token)
            chrome = request_json('http://127.0.0.1:19322/json/version')
            with urllib.request.urlopen('http://127.0.0.1:16080/vnc.html', timeout=3) as r:
                assert r.status == 200
            assert chrome.get('webSocketDebuggerUrl') and identity.get('instanceId')
            return identity
        except Exception: time.sleep(1)
    raise RuntimeError('电脑环境未就绪，请检查 openbot-desktop、openbot-browser、openbot-viewer、openbot-runtime 服务日志后重试。')

def unit_file(description, command, dependencies='', extra=''):
    return f'''[Unit]
Description={description}
After=network-online.target {dependencies}
Requires={dependencies}
[Service]
Type=simple
User={USER}
Group={USER}
WorkingDirectory={STATE}
Environment=HOME={STATE}
Environment=DISPLAY=:41
Environment=XAUTHORITY={STATE}/.Xauthority
{extra}
ExecStart={command}
Restart=on-failure
RestartSec=3
UMask=0077
[Install]
WantedBy=multi-user.target
'''

def install_stack(payload):
    engine = install(payload['lock'])
    with (ROOT / 'install.lock').open('w') as guard:
        try: fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise RuntimeError('初始化正在进行，请稍后重试。')
        return install_stack_locked(payload, engine)

def install_stack_locked(payload, engine):
    model = payload.get('model', {})
    if not model.get('name') or not model.get('apiKey'):
        raise RuntimeError('请先配置远端模型名称和 API Key；执行引擎已保留，可补充后重试。')
    if any('\n' in str(v) or '\r' in str(v) or '\x00' in str(v) for v in model.values()):
        raise RuntimeError('模型配置不能包含换行或空字符。')
    units = ['openbot-desktop', 'openbot-window-manager', 'openbot-browser', 'openbot-viewer', 'openbot-runtime']
    owners = ['openbot-runtime','openbot-browser','openbot-desktop','openbot-viewer']
    for port, owner in zip(STACK_PORTS.values(), owners):
        if subprocess.run(['systemctl','is-active','--quiet',owner]).returncode != 0:
            with socket.socket() as sock:
                try: sock.bind(('127.0.0.1',port))
                except OSError: raise RuntimeError(f'初始化端口 {port} 被其他服务占用，未停止它。')
    # Do not interrupt a user's active work or private browser context during an upgrade.
    runtime_state = STATE / 'runtime'
    if runtime_state.exists():
        for task in runtime_state.glob('*.json'):
            if json.loads(task.read_text()).get('status') not in ['succeeded','failed','interrupted']:
                raise RuntimeError('远端仍有未结束任务。请完成或取消任务后再初始化，避免丢失浏览器会话。')
    if shutil.disk_usage(ROOT).free < 2 * 1024**3:
        raise RuntimeError('完整环境初始化需要至少 2 GiB 可用磁盘。')
    # Ubuntu native dependencies retain distribution security updates; application binaries are pinned.
    packages = ['tigervnc-standalone-server','openbox','novnc','websockify','xauth','fonts-noto-cjk','fonts-liberation',
                'libnss3','libatk-bridge2.0-0','libcups2t64','libxkbcommon0','libxcomposite1','libxdamage1','libxrandr2',
                'libgbm1','libasound2t64','libgtk-3-0t64','libxss1','libdrm2','xdg-utils','xz-utils','unzip','curl']
    if subprocess.run(['dpkg-query','-W','-f=${Status}\n',*packages], stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
        run('apt-get','update')
        run('apt-get','install','-y','--no-install-recommends',*packages)
    assets = payload['assets']
    node_dir = download_asset('node',assets['node'])
    chrome_dir = download_asset('chromium',assets['chromium']) / 'chrome-linux64'
    node = node_dir / f"node-v{assets['node']['version']}-linux-x64/bin/node"
    chrome = chrome_dir / 'chrome'
    sandbox = chrome_dir / 'chrome_sandbox'
    os.chown(sandbox,0,0); os.chmod(sandbox,0o4755)
    for folder in ['runtime','browser-profile','workspace']:
        run('install','-d','-o',USER,'-g',USER,'-m','700',str(STATE/folder))
    if not (STATE/'.Xauthority').exists():
        run('runuser','-u',USER,'--','xauth','-f',str(STATE/'.Xauthority'),'add',':41','MIT-MAGIC-COOKIE-1',secrets.token_hex(16))
    runtime_bytes = base64.b64decode(payload['runtime']['archive'],validate=True)
    runtime_sha = hashlib.sha256(runtime_bytes).hexdigest()
    if runtime_sha != payload['runtime']['sha256']: raise RuntimeError('Bot Runtime 包校验失败。')
    release = ROOT / 'runtimes' / runtime_sha[:16]
    if not (release/'package.json').exists():
        release.mkdir(parents=True,exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(runtime_bytes),mode='r:gz') as archive:
            archive.extractall(release,filter='data')
    if json.loads((release/'package.json').read_text()).get('sourceCommit') != payload['runtime']['sourceCommit']:
        raise RuntimeError('Runtime 源码版本与安装请求不一致。')
    env_path = ROOT / 'runtime.env'
    env = '\n'.join(k+'='+json.dumps(v) for k,v in {
        'BOT_DATA_DIR':str(runtime_state),'BOT_WORKSPACE':str(STATE/'workspace'),'BOT_PORT':'13850',
        'OH_BASE_URL':'http://127.0.0.1:18000','BOT_BROWSER_CDP_URL':'http://127.0.0.1:19322',
        'OH_LLM_MODEL':model['name'],'OH_LLM_API_KEY':model['apiKey'],'OH_LLM_BASE_URL':model.get('baseUrl','')}.items())+'\n'
    token_path = runtime_state / 'service-token'
    if not token_path.exists():
        token_path.write_text(secrets.token_hex(32)); os.chmod(token_path,0o600)
        account=pwd.getpwnam(USER); os.chown(token_path,account.pw_uid,account.pw_gid)
    token = token_path.read_text().strip()
    # Node is supplied to the browser probe via the same fixed binary used by Runtime.
    definitions = {
        'openbot-desktop':unit_file('OpenBot virtual desktop','/usr/bin/Xtigervnc :41 -geometry 1280x800 -depth 24 -rfbport 15901 -localhost yes -SecurityTypes None -nolisten tcp -auth '+str(STATE/'.Xauthority')),
        'openbot-window-manager':unit_file('OpenBot desktop window manager','/usr/bin/openbox','openbot-desktop.service'),
        'openbot-browser':unit_file('OpenBot visible browser',str(chrome)+' --user-data-dir='+str(STATE/'browser-profile')+' --remote-debugging-address=127.0.0.1 --remote-debugging-port=19322 --disable-dev-shm-usage --no-first-run --no-default-browser-check about:blank','openbot-desktop.service',f'Environment=CHROME_DEVEL_SANDBOX={sandbox}'),
        'openbot-viewer':unit_file('OpenBot desktop viewer','/usr/bin/websockify --web=/usr/share/novnc 127.0.0.1:16080 127.0.0.1:15901','openbot-desktop.service'),
        'openbot-runtime':unit_file('OpenBot task runtime',str(node)+' '+str(release/'bot/main.js'),'openbot-engine.service openbot-browser.service',f'EnvironmentFile={ROOT}/engine.env\nEnvironmentFile={env_path}'),
    }
    previous = {name:(UNITS/(name+'.service')).read_text() if (UNITS/(name+'.service')).exists() else None for name in units}
    old_env = env_path.read_text() if env_path.exists() else None
    changed = [name for name in units if previous[name] != definitions[name]]
    if old_env != env and 'openbot-runtime' not in changed: changed.append('openbot-runtime')
    try:
        fd=os.open(env_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as file:file.write(env)
        for name in units: (UNITS/(name+'.service')).write_text(definitions[name])
        run('systemctl','daemon-reload')
        run('systemctl','enable',*units)
        for name in units:
            if name in changed: run('systemctl','restart',name)
            else: run('systemctl','start',name)
        identity=wait_stack(token)
        probe = ROOT / 'browser-smoke.mjs'
        probe.write_text(payload['browserProbe'])
        run('runuser','-u',USER,'--',str(node),str(probe))
        verify_execution(engine['sessionApiKey'])
    except Exception:
        for name in reversed(units):
            if name in changed: run('systemctl','stop',name)
        for name in units:
            target=UNITS/(name+'.service')
            if previous[name] is None:
                run('systemctl','disable',name);target.unlink(missing_ok=True)
            else:target.write_text(previous[name])
        if old_env is None: env_path.unlink(missing_ok=True)
        else:env_path.write_text(old_env)
        run('systemctl','daemon-reload')
        for name in units:
            if previous[name] is not None and name in changed: run('systemctl','start',name)
        raise
    return {**engine,'stack':{'runtimePort':13850,'desktopPort':16080,'cdpPort':19322,'token':token,'instanceId':identity['instanceId'],'sourceCommit':payload['runtime']['sourceCommit'],'changed':bool(changed),'nodeVersion':assets['node']['version'],'browserVersion':assets['chromium']['version']}}

if __name__ == '__main__':
    try:
        print(json.dumps(install_stack(json.load(sys.stdin))))
    except Exception as error:
        message=str(error) if isinstance(error,RuntimeError) else '完整初始化失败，请检查 /opt/openbot-engine/install.log 和服务日志；原连接配置未切换。'
        print(json.dumps({'error':message}));sys.exit(1)
