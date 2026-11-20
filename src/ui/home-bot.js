// The homepage is a client of the same versioned runtime as future host apps.
// Never retry a mutation automatically; a submitted request keeps its id until acknowledged.
export function createHomeBot({ add, renderMarkdown, refreshDesktop }) {
  const $ = id => document.getElementById(id);
  const labels = { queued: '已接收 · 排队中', starting: '正在启动', running: '执行中', waiting_approval: '等待确认', paused: '已暂停', succeeded: '已完成', failed: '执行失败', interrupted: '需核对远端状态' };
  let session = document.querySelector('meta[name="bot-session"]').content;
  let connected = false, connecting, polling = false, sending = false, nextReconnect = 0;
  let threadId = localStorage.getItem('openbot-home-thread');
  if (!threadId) { threadId = crypto.randomUUID(); localStorage.setItem('openbot-home-thread', threadId); }
  let pending;
  try { pending = JSON.parse(localStorage.getItem('openbot-home-pending') || 'null'); } catch { pending = null; }
  if (pending) $('box').value = pending.goal;
  const cards = new Map();
  const deciding = new Set();
  function notice(text, ok = false) {
    $('bot-status').textContent = text;
    $('lamp').classList.toggle('ok', ok);
    $('meta').textContent = ok ? '远端任务已连接 · 关闭页面不中断执行' : text;
  }
  async function api(route, method = 'GET', data) {
    const r = await fetch('/api/bot/' + route, { method, headers: { 'X-OpenBot-Session': session, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const b = await r.json();
    if (!r.ok) { const e = new Error(r.status === 403 ? '本地服务已重启，正在恢复连接；请核对任务后再操作。' : b.error || '请求失败'); e.status = r.status; throw e; }
    return b;
  }
  function disconnected(error) {
    connected = false;
    notice('连接中断，任务仍保留；正在尝试恢复。');
    $('banner').textContent = error.message;
    $('banner').classList.add('show');
  }
  async function reconnect(credentials) {
    if (connecting) return connecting;
    connecting = (async () => {
      notice('正在连接远端电脑…');
      try {
        // A local service restart rotates the page session. Refresh only this credential,
        // preserving the current view and pending submission identity.
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const fresh = new DOMParser().parseFromString(html, 'text/html').querySelector('meta[name="bot-session"]')?.content;
        if (!fresh || !/^[a-f0-9]{64}$/.test(fresh)) throw Error('无法验证本地页面连接凭据');
        session = fresh;
        const info = await api('connection');
        if (!info.configured && !credentials?.token) {
          connected = false; nextReconnect = Date.now() + 15000;
          notice('请在本页设置执行服务令牌，然后连接。'); return;
        }
        const identity = await api('connect', 'POST', credentials || {});
        connected = true;
        $('home-token').value = '';
        notice(identity.execution.ok ? '已连接 · 远端执行可用' : '任务服务已连接，执行服务暂不可用', identity.execution.ok);
        $('banner').classList.remove('show');
        await refresh();
      } catch (error) { disconnected(error); nextReconnect = Date.now() + 5000; }
    })().finally(() => { connecting = undefined; });
    return connecting;
  }
  function render(task) {
    let card = cards.get(task.id);
    if (!card) {
      add('user', '', task.goal);
      const node = add('bot', '', '');
      node.dataset.taskId = task.id;
      const bubble = node.querySelector('.bubble');
      const state = document.createElement('p'); state.setAttribute('role', 'status');
      const actions = document.createElement('div');
      bubble.prepend(state); bubble.append(actions);
      card = { node, state, actions, body: node.querySelector('.md'), revision: -1 };
      cards.set(task.id, card);
    }
    if (card.revision === task.revision) return;
    card.revision = task.revision;
    const approvalSent = task.status === 'waiting_approval' && task.pendingActions?.length && task.pendingActions.every(a => task.decidedActionIds?.includes(a.id));
    card.state.textContent = `${approvalSent ? '确认已提交 · 等待远端响应' : labels[task.status] || task.status} · ${task.id.slice(0,8)}`;
    card.body.innerHTML = renderMarkdown(task.result || task.error || (task.status === 'running' ? '远端正在执行，完成后结果会保留在这里。' : ''));
    card.actions.replaceChildren();
    const button = (label, action, accept) => {
      const btn = document.createElement('button'); btn.textContent = label; btn.type = 'button'; btn.style.margin = '6px';
      btn.disabled = deciding.has(task.id);
      btn.onclick = async () => {
        if (deciding.has(task.id)) return;
        deciding.add(task.id); btn.disabled = true;
        try {
          const data = await api(`tasks/${task.id}/${action}`, 'POST', { revision: task.revision, accept });
          card.revision = -1; render(data.task); await refresh();
        } catch (error) {
          card.state.textContent = error.message;
          if (!error.status || error.status >= 500 || error.status === 403) disconnected(error);
          // Observe before another decision. Never silently resend an approval.
          card.revision = -1;
        } finally { deciding.delete(task.id); card.revision = -1; await refresh(); }
      };
      card.actions.append(btn);
    };
    if (task.pendingActions?.length) {
      const details = document.createElement('details'); details.open = task.status === 'waiting_approval';
      const summary = document.createElement('summary'); summary.textContent = '待执行动作';
      const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.style.maxHeight = '230px'; pre.style.overflow = 'auto';
      pre.textContent = task.pendingActions.map(a => JSON.stringify({ summary: a.summary, tool: a.tool, action: a.action }, null, 2)).join('\n');
      details.append(summary, pre); card.actions.append(details);
    }
    if (task.status === 'waiting_approval' && !approvalSent) { button('允许本次动作', 'approval', true); button('拒绝本次动作', 'approval', false); }
    if (task.status === 'running') button('暂停任务', 'pause');
    if (task.status === 'paused' && !task.error) button('继续任务', 'resume');
    if (task.error || task.status === 'paused' || approvalSent) button('核对远端状态', 'refresh');
    if (task.status === 'succeeded') refreshDesktop();
  }
  async function refresh() {
    if (!connected || polling) return;
    polling = true;
    try {
      const all = []; let offset = 0;
      do {
        const page = await api('tasks?threadId=' + encodeURIComponent(threadId) + '&offset=' + offset);
        all.push(...page.tasks); offset = page.nextOffset;
      } while (offset !== null && offset !== undefined);
      for (const task of all.reverse()) render(task);
      if (pending && all.some(t => t.requestId === pending.requestId)) {
        if ($('box').value === pending.goal) $('box').value = '';
        pending = null; localStorage.removeItem('openbot-home-pending');
      }
    } catch (error) { disconnected(error); } finally { polling = false; }
  }
  async function send() {
    if (sending) return;
    const goal = $('box').value.trim(); if (!goal) return;
    if (!connected) { await reconnect(); if (!connected) return; }
    if (pending && pending.goal !== goal) {
      $('box').value = pending.goal;
      notice('上一条请求尚未确认，保留原请求重试可避免重复执行。'); return;
    }
    pending ||= { requestId: crypto.randomUUID(), threadId, goal, source: { kind: 'openbot-home' } };
    localStorage.setItem('openbot-home-pending', JSON.stringify(pending));
    sending = true; $('send').disabled = true;
    try {
      const { task } = await api('tasks', 'POST', pending);
      pending = null; localStorage.removeItem('openbot-home-pending');
      $('box').value = ''; render(task); notice('已连接 · 任务已接收，结果保存在远端。', true);
      $('log').scrollTop = $('log').scrollHeight;
    } catch (error) { disconnected(error); } finally { sending = false; $('send').disabled = false; }
  }
  $('bot-reconnect').onclick = () => reconnect();
  $('home-connect-save').onclick = () => reconnect($('home-token').value.trim() ? { token: $('home-token').value.trim(), remotePort: Number($('home-port').value) } : undefined);
  $('home-browse').onsubmit = async e => {
    e.preventDefault();
    try {
      const { entries } = await api('files?path=' + encodeURIComponent($('home-directory').value));
      $('home-file-list').replaceChildren();
      for (const entry of entries) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = entry.name + (entry.type === 'directory' ? '/' : ''); btn.style.display = 'block';
        btn.onclick = async () => {
          try {
            if (entry.type === 'directory') { $('home-directory').value = entry.path; $('home-browse').requestSubmit(); return; }
            const file = await api('file?path=' + encodeURIComponent(entry.path));
            $('home-file-preview').textContent = file.path + '\n\n' + file.content;
          } catch (error) { $('home-file-preview').textContent = error.message; }
        };
        $('home-file-list').append(btn);
      }
    } catch (error) { $('home-file-preview').textContent = error.message; }
  };
  return { send, reconnect, start() { reconnect(); setInterval(() => connected ? refresh() : Date.now() >= nextReconnect && reconnect(), 3000); } };
}
