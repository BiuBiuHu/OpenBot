import assert from 'node:assert/strict';
import fs from 'node:fs';
import { it } from 'node:test';
// @ts-ignore Browser ES module is intentionally shared with these tests.
import { resolveLanguage, t, setLanguage, getPreference, uiText, setText, clearBindings } from '../src/ui/i18n.js';
// @ts-ignore
import { messages } from '../src/ui/locales.js';

it('browser preference uses Chinese variants, English fallback, and explicit overrides', () => {
  assert.equal(resolveLanguage('auto', ['zh-TW', 'en']), 'zh-CN');
  assert.equal(resolveLanguage('auto', ['zh-Hant-HK']), 'zh-CN');
  assert.equal(resolveLanguage('auto', ['en-GB', 'zh-CN']), 'en');
  assert.equal(resolveLanguage('auto', ['fr-FR', 'zh-CN']), 'en');
  assert.equal(resolveLanguage('auto', []), 'en');
  assert.equal(resolveLanguage('en', ['zh-CN']), 'en');
  assert.equal(resolveLanguage('zh-CN', ['en-US']), 'zh-CN');
});

it('switching updates bound chrome without recreating inputs or translating user content', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const input = { value: 'synthetic-secret', type: 'password' };
  const output = { textContent: '执行中', isConnected: true };
  const label = { textContent: '', isConnected: true };
  const root = { lang: '' };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root, querySelectorAll: () => [] } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: () => {} } });
  try {
    setLanguage('en');
    uiText(label, '填写并继续');
    assert.equal(label.textContent, 'Fill and continue');
    setLanguage('zh-CN');
    assert.equal(label.textContent, '填写并继续');
    assert.equal(input.value, 'synthetic-secret');
    assert.equal(input.type, 'password');
    assert.equal(output.textContent, '执行中');
    assert.equal(root.lang, 'zh-CN');
    setText(label, () => t('执行中') + ' · abc123');
    setLanguage('en');
    assert.equal(label.textContent, 'Running · abc123');
    clearBindings(label);
    label.textContent = 'Model output: 执行中';
    setLanguage('zh-CN');
    assert.equal(label.textContent, 'Model output: 执行中');
    setLanguage('invalid');
    assert.equal(getPreference(), 'zh-CN');
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete (globalThis as any).document;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete (globalThis as any).window;
    setLanguage('auto');
  }
});

it('all explicitly marked static UI strings have both translations', () => {
  const keys = new Set(messages.flat());
  for (const name of ['index.html', 'bot.html', 'oh-test.html', 'desktop-view.html']) {
    const html = fs.readFileSync('src/ui/' + name, 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g)) {
      assert.ok(keys.has(match[1].replaceAll('&amp;', '&').replaceAll('&quot;', '"')), name + ': ' + match[1]);
    }
    assert.match(html, /initI18n\(\)/);
  }
  for (const [zh, en] of messages) {
    assert.ok(zh.trim() && en.trim());
    assert.ok(!/[\u3400-\u9fff]/.test(en), 'English copy contains untranslated text: ' + en);
  }
});

it('blocked browser storage still allows in-memory language selection', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { throw new Error('Storage disabled'); },
    setItem() { throw new Error('Storage disabled'); },
  } });
  try {
    // @ts-ignore Import separately to exercise initialization with blocked storage.
    const isolated = await import('../src/ui/i18n.js?blocked-storage');
    isolated.setLanguage('en');
    assert.equal(isolated.t('填写并继续'), 'Fill and continue');
    isolated.setLanguage('zh-CN');
    assert.equal(isolated.t('Fill and continue'), '填写并继续');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as any).localStorage;
  }
});
