import { messages } from './locales.js';

export const preferenceKey = 'openbot-ui-language';
const supported = ['auto', 'en', 'zh-CN'];
export function resolveLanguage(preference, languages = []) {
  if (preference === 'en' || preference === 'zh-CN') return preference;
  return /^zh(?:-|$)/i.test(languages[0] || '') ? 'zh-CN' : 'en';
}
let preference = 'auto';
try { const saved = globalThis.localStorage?.getItem(preferenceKey); if (supported.includes(saved)) preference = saved; } catch {}
export function getLanguage() {
  return resolveLanguage(preference, globalThis.navigator?.languages?.length ? navigator.languages : [globalThis.navigator?.language]);
}
export function getPreference() { return preference; }
const dictionary = new Map();
for (const [zh, en] of messages) { dictionary.set(zh, { en, 'zh-CN': zh }); dictionary.set(en, { en, 'zh-CN': zh }); }
const mail = {
  'zh-CN': '打开 https://mail.163.com/，通过私密输入工具请我填写账号和密码，登录后总结任务开始前最近 24 小时的收件箱邮件。请用 Asia/Shanghai 时间说明统计范围、已读取数量、主要内容与待办，明确任何未读取范围。只读邮件，不发送、删除或移动邮件。遇到验证码、扫码或无法继续时，立即请求我接管。任务开始时间：',
  en: 'Open https://mail.163.com/. Ask me for my account and password through the private input tool. After login, summarize inbox emails from the 24 hours before this task started. Report the time range in Asia/Shanghai time, the number read, key points, action items, and any unread scope. Read only: do not send, delete, or move emails. Request human takeover immediately for verification codes, QR login, or any blocker. Respond in English. Task start time: '
};
export function t(source) { if (source === 'mail.example') return mail[getLanguage()]; return dictionary.get(source)?.[getLanguage()] ?? source; }

// Only explicitly bound UI text is translated. No document-wide text observer:
// task results, filenames, passwords, and website content are never scanned.
const bindings = new Map();
let cleanupQueued = false;
function bind(node, property, render) {
  if (!bindings.has(node)) bindings.set(node, new Map());
  bindings.get(node).set(property, render);
  render();
  if (!cleanupQueued) {
    cleanupQueued = true;
    queueMicrotask(() => {
      cleanupQueued = false;
      for (const node of bindings.keys()) if (!node.isConnected) bindings.delete(node);
    });
  }
}
export function clearBindings(node) { bindings.delete(node); }
export function setText(node, value) {
  bind(node, 'text', () => {
    const next = String(value() ?? '');
    if (node.textContent !== next) node.textContent = next;
  });
}
export function uiText(node, source) { setText(node, () => t(source)); }
export function textNode(source) {
  const node = document.createTextNode('');
  uiText(node, source);
  return node;
}
export function setAttr(node, name, value) { bind(node, name, () => node.setAttribute(name, value())); }
export function setLanguage(next) {
  if (!supported.includes(next)) return;
  preference = next;
  try { localStorage.setItem(preferenceKey, next); } catch {}
  update();
}
function update() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = getLanguage();
  for (const [node, props] of bindings) {
    if (!node.isConnected) { bindings.delete(node); continue; }
    for (const render of props.values()) render();
  }
  document.querySelectorAll('[data-language-picker]').forEach(picker => { picker.value = preference; });
  window.dispatchEvent(new CustomEvent('openbot-languagechange', { detail: { language: getLanguage() } }));
}
export function initI18n() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-i18n]').forEach(node => uiText(node, node.dataset.i18n));
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    document.querySelectorAll('[data-i18n-' + attr + ']').forEach(node => {
      const source = node.getAttribute('data-i18n-' + attr);
      setAttr(node, attr, () => t(source));
    });
  }
  document.querySelectorAll('[data-language-picker]').forEach(picker => {
    picker.value = preference;
    picker.onchange = () => setLanguage(picker.value);
  });
  update();
}
if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => { if (preference === 'auto') update(); });
  window.addEventListener('storage', event => {
    if (event.key === preferenceKey) { preference = supported.includes(event.newValue) ? event.newValue : 'auto'; update(); }
  });
}
