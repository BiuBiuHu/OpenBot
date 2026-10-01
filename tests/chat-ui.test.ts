import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createComposeGuard,
  renderMarkdown,
  shouldSendOnEnter,
} from "../src/ui/chat-ui.js";

describe("assistant markdown", () => {
  it("TC-UI-MD-001: renders bold, lists, tables, code, and links", () => {
    const html = renderMarkdown(
      [
        "这是 **粗体** 和 `code`。",
        "",
        "- 一项",
        "- 二项",
        "",
        "1. 先做",
        "2. 再做",
        "",
        "| 列 | 值 |",
        "| --- | --- |",
        "| a | **b** |",
        "",
        "看 [文档](https://example.com/docs)。",
        "",
        "```js",
        "const x = 1;",
        "```",
      ].join("\n"),
    );
    assert.match(html, /<strong>粗体<\/strong>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /<ul>.*<li>一项<\/li>.*<li>二项<\/li>.*<\/ul>/s);
    assert.match(html, /<ol>.*<li>先做<\/li>.*<li>再做<\/li>.*<\/ol>/s);
    assert.match(html, /<table>/);
    assert.match(html, /<th>列<\/th>/);
    assert.match(html, /<td><strong>b<\/strong><\/td>/);
    assert.match(html, /<a href="https:\/\/example.com\/docs" target="_blank" rel="noopener noreferrer">文档<\/a>/);
    assert.match(html, /<pre><code class="language-js">const x = 1;<\/code><\/pre>/);
  });

  it("TC-UI-MD-002: escapes raw HTML and drops javascript links", () => {
    const html = renderMarkdown(
      'alert <script>alert(1)</script> and [x](javascript:alert(1)) and [ok](https://ok.example)',
    );
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /<a href="https:\/\/ok.example"/);
  });
});

describe("IME Enter", () => {
  it("TC-UI-IME-001: Enter sends only when not composing and keyCode is not 229", () => {
    const enter = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };
    assert.equal(shouldSendOnEnter(enter), true);
    assert.equal(shouldSendOnEnter({ ...enter, isComposing: true }), false);
    assert.equal(shouldSendOnEnter({ ...enter, keyCode: 229 }), false);
    assert.equal(shouldSendOnEnter({ ...enter, isComposing: true, keyCode: 229 }), false);
    assert.equal(shouldSendOnEnter({ ...enter, shiftKey: true }), false);
    assert.equal(shouldSendOnEnter({ key: "Process", shiftKey: false, isComposing: false, keyCode: 229 }), false);
    assert.equal(shouldSendOnEnter(enter, true), false);
  });

  it("TC-UI-IME-002: compositionend locks the confirming Enter", () => {
    const guard = createComposeGuard();
    const enter = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };
    guard.onCompositionStart();
    assert.equal(guard.active(), true);
    assert.equal(shouldSendOnEnter(enter, guard.active()), false);
    guard.onCompositionEnd();
    assert.equal(guard.active(), true);
    assert.equal(shouldSendOnEnter(enter, guard.active()), false);
  });
});
