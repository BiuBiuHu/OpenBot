import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyChatLanguage,
  DEFAULT_CHAT_LANGUAGE,
  normalizeChatLanguage,
  prefersChineseSearch,
  toSimplified,
  toTraditional,
} from "../src/language.js";

describe("chat language", () => {
  it("defaults to Simplified Chinese", () => {
    assert.equal(DEFAULT_CHAT_LANGUAGE, "zh-CN");
    assert.equal(normalizeChatLanguage(""), "zh-CN");
    assert.equal(normalizeChatLanguage("nope"), "zh-CN");
    assert.equal(normalizeChatLanguage("zh-TW"), "zh-TW");
    assert.equal(normalizeChatLanguage("en-US"), "en");
    assert.equal(prefersChineseSearch("zh-CN"), true);
    assert.equal(prefersChineseSearch("en"), false);
  });

  it("converts the live Traditional search sentence to Simplified", () => {
    const raw = "Grok是xAI基于大型语言模型开发的生成式人工智慧聊天機器人,類似於ChatGPT。";
    const shown = applyChatLanguage(raw, "zh-CN");
    assert.match(shown, /人工智能/);
    assert.match(shown, /聊天机器人/);
    assert.match(shown, /类似于/);
    assert.doesNotMatch(shown, /機器人/);
    assert.doesNotMatch(shown, /類似於/);
    assert.doesNotMatch(shown, /人工智慧/);
  });

  it("can emit Traditional when the setting is zh-TW", () => {
    const shown = toTraditional("网上查过了。Grok 是 xAI 做的生成式对话机器人。");
    assert.match(shown, /網上查過了|网上查过了/);
    assert.match(shown, /機器人/);
    assert.equal(toSimplified(shown).includes("机器人"), true);
  });
});
