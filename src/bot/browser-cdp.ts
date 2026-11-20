import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BotError } from './contracts.js';

/** Narrow browser driver. Its private evaluate primitive is never exposed as an Agent tool. */
export class BrowserCDP {
  private socket?: WebSocket;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private target?: string;
  private session?: string;
  private context?: string;
  private elements = new Map<string, { session: string; context: number; index: number; origin: string }>();
  private secrets = new Set<string>();
  private captureManual = false;
  beginManualCapture() { this.captureManual = true; }
  async endManualCapture() { if (this.session) await this.evaluate('void 0'); this.captureManual = false; }
  constructor(private endpoint: string, private allowedLocalOrigins = (process.env.BOT_PRIVATE_BROWSER_ALLOWED_ORIGINS || '').split(',').filter(Boolean)) {}
  private async validateURL(raw: string) {
    if (raw === 'about:blank') return;
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new BotError('Expected a web URL');
    if (this.allowedLocalOrigins.includes(url.origin)) return;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(a => !isPublicBrowserAddress(a.address))) throw new BotError('Private network pages are unavailable in protected browsing');
  }
  private async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const endpoint = new URL(this.endpoint);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new BotError('Browser endpoint must be local');
    const info = await (await fetch(new URL('/json/version', endpoint), { signal: AbortSignal.timeout(5000) })).json() as { webSocketDebuggerUrl: string };
    const socket = new WebSocket(info.webSocketDebuggerUrl); this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Browser unavailable')); }, 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Browser unavailable')); }, { once: true });
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.bindingCalled' && message.params?.name === '__openbotPrivateInput') {
        try { const value = JSON.parse(message.params.payload); if (this.captureManual && typeof value === 'string' && value.length && value.length <= 4096) this.secrets.add(value); } catch {}
        return;
      }
      const waiter = this.pending.get(message.id); if (!waiter) return;
      clearTimeout(waiter.timer); this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error('Browser action failed')); else waiter.resolve(message.result);
    });
    socket.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Browser disconnected')); } this.pending.clear(); });
  }
  private async call(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    await this.connect(); const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Browser action timed out')); }, 10000);
      this.pending.set(id, { resolve, reject, timer }); this.socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async open() {
    if (this.session) return;
    this.context = (await this.call('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId;
    this.target = (await this.call('Target.createTarget', { url: 'about:blank', browserContextId: this.context })).targetId;
    this.session = (await this.call('Target.attachToTarget', { targetId: this.target, flatten: true })).sessionId;
    await this.call('Page.enable', {}, this.session);
    await this.protectManualInput(this.session!);
  }
  private async protectManualInput(session: string) {
    await this.call('Runtime.enable', {}, session);
    await this.call('Runtime.addBinding', { name: '__openbotPrivateInput', executionContextName: 'openbot-private' }, session);
    await this.call('Page.addScriptToEvaluateOnNewDocument', { worldName: 'openbot-private', runImmediately: true, source: `(() => {
      if(globalThis.__openbotInputProtected)return;globalThis.__openbotInputProtected=true;
      const capture=e=>{const t=e.target;if(t&&(t.tagName==='TEXTAREA'||(t.tagName==='INPUT'&&!['checkbox','radio','button','submit','hidden'].includes(t.type)))){try{globalThis.__openbotPrivateInput(JSON.stringify(t.value));}catch{}}};
      for(const event of ['input','change','focusout'])document.addEventListener(event,capture,true);
    })()` }, session);
  }
  private async evaluate(expression: string, session = this.session!, contextId?: number): Promise<any> {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, session);
    if (result.exceptionDetails) throw new Error('Browser page operation failed');
    return result.result?.value;
  }
  async navigate(url: string) {
    await this.validateURL(url);
    const target = new URL(url); if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) throw new BotError('Expected a web URL');
    await this.open(); this.elements.clear();
    const result = await this.call('Page.navigate', { url: target.href }, this.session);
    if (result.errorText) throw new Error('Page could not be loaded');
    return { status: 'navigated' };
  }
  private async frames(): Promise<Array<{ session: string; context: number }>> {
    await this.open(); const tree = await this.call('Page.getFrameTree', {}, this.session);
    const out: Array<{ session: string; context: number }> = [];
    const visit = async (node: any) => {
      await this.validateURL(node.frame.url || 'about:blank');
      let session = this.session!;
      try { const world = await this.call('Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'openbot-private' }, session); out.push({ session, context: world.executionContextId }); }
      catch {
        try { session = (await this.call('Target.attachToTarget', { targetId: node.frame.id, flatten: true })).sessionId; await this.protectManualInput(session); const world = await this.call('Page.createIsolatedWorld', { frameId: node.frame.id, worldName: 'openbot-private' }, session); out.push({ session, context: world.executionContextId }); } catch { /* inaccessible frames are reported by missing elements, never guessed */ }
      }
      for (const child of node.childFrames || []) await visit(child);
    };
    await visit(tree.frameTree); return out;
  }
  async observe() {
    this.elements.clear(); const pages = [];
    for (const frame of await this.frames()) {
      const page = await this.evaluate(`(() => {
        const visible = e => !!(e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
        const els = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"]')].filter(visible);
        globalThis.__openbotElements = els;
        return {url:location.href,origin:location.origin,title:document.title,text:(document.body?.innerText||'').slice(0,24000),elements:els.slice(0,250).map((e,index)=>({index,tag:e.tagName.toLowerCase(),type:e.getAttribute('type')||'',label:e.getAttribute('aria-label')||e.labels?.[0]?.textContent||e.getAttribute('placeholder')||e.textContent?.slice(0,160)||''}))};
      })()`, frame.session, frame.context);
      if (!page) continue;
      for (const element of page.elements) { const id = String(this.elements.size + 1); this.elements.set(id, { ...frame, index: element.index, origin: page.origin }); element.id = id; delete element.index; }
      pages.push(page);
    }
    return this.redact({ pages });
  }
  private element(id: string) { const element = this.elements.get(id); if (!element) throw new BotError('Element expired; observe the page again'); return element; }
  async fieldTarget(id: string) {
    const e = this.element(id);
    const current = await this.evaluate(`(() => {const e=globalThis.__openbotElements?.[${e.index}];return e && e.isConnected && ['INPUT','TEXTAREA'].includes(e.tagName) ? {origin:location.origin,type:e.type||'text'} : null;})()`, e.session, e.context);
    if (!current || current.origin !== e.origin) throw new BotError('Input target changed', 409);
    return current as { origin: string; type: string };
  }
  async click(id: string) {
    const e = this.element(id);
    await this.evaluate(`(() => {const e=globalThis.__openbotElements?.[${e.index}];if(!e?.isConnected)throw Error();e.click();})()`, e.session, e.context);
    return { status: 'clicked' };
  }
  async type(id: string, value: string, secret = false) {
    const field = await this.fieldTarget(id); if (!secret && field.type === 'password') throw new BotError('Use private input for this field');
    if (secret) this.secrets.add(value);
    const e = this.element(id);
    await this.evaluate(`(() => {const e=globalThis.__openbotElements?.[${e.index}];if(!e?.isConnected||location.origin!==${JSON.stringify(e.origin)})throw Error();const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`, e.session, e.context);
    return { status: 'filled' };
  }
  redact<T>(value: T): T {
    let text = JSON.stringify(value);
    for (const secret of [...this.secrets].sort((a,b)=>b.length-a.length)) for (const variant of [secret, encodeURIComponent(secret)]) text = text.split(JSON.stringify(variant).slice(1,-1)).join('[private]');
    return JSON.parse(text);
  }
  async close() {
    try { if (this.context) await this.call('Target.disposeBrowserContext', { browserContextId: this.context }); } finally { this.socket?.close(); this.secrets.clear(); this.elements.clear(); }
  }
}

export function isPublicBrowserAddress(address: string): boolean {
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
}
