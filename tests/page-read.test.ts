import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  extractDocumentFacts,
  extractPublicHttpUrl,
  isDocumentReadAsk,
  readableDocumentUrl,
  readPublicDocument,
} from "../src/page-read.js";
import { needsLookup } from "../src/chat-voice.js";

const LIVE =
  "看看 https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md 这个文档讲了什么?";
const LIVE_EXACT =
  "https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md 这个讲的是什么?";

describe("page-read", () => {
  it("TC-DOC-001: the live document question is a document ask, not a lookup", () => {
    assert.equal(isDocumentReadAsk(LIVE), true);
    assert.equal(needsLookup(LIVE), false);
    assert.equal(isDocumentReadAsk(LIVE_EXACT), true);
    assert.equal(needsLookup(LIVE_EXACT), false);
    assert.equal(
      extractPublicHttpUrl(LIVE),
      "https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md",
    );
    assert.equal(isDocumentReadAsk("Grok Bot 是什么"), false);
    assert.equal(isDocumentReadAsk("https://example.com/page"), false);
    assert.equal(
      isDocumentReadAsk("https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md 这个讲的是什么?"),
      true,
    );
  });

  it("TC-DOC-002: GitHub blob pages rewrite to raw.githubusercontent.com", () => {
    assert.equal(
      readableDocumentUrl("https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md"),
      "https://raw.githubusercontent.com/bojieli/ai-agent-book/main/book/chapter3.md",
    );
    assert.equal(readableDocumentUrl("https://example.com/notes.md"), "https://example.com/notes.md");
  });

  it("TC-DOC-006: readPublicDocument fetches the raw URL and keeps the original href", async () => {
    const requested: string[] = [];
    const body = "# 用户记忆和知识库\n\n这一章讲公开页怎么读。\n后面还有一句补充说明给抽取用。";
    const doc = await readPublicDocument(LIVE, {
      fetch: async (input) => {
        requested.push(String(input));
        return new Response(body, { status: 200, headers: { "content-type": "text/markdown" } });
      },
    });
    assert.ok(doc);
    assert.equal(doc.title, "用户记忆和知识库");
    assert.equal(doc.url, "https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md");
    assert.deepEqual(requested, [
      "https://raw.githubusercontent.com/bojieli/ai-agent-book/main/book/chapter3.md",
    ]);
  });

  it("extracts a heading and a 本章/本文 sentence without chapter-specific keywords", () => {
    const facts = extractDocumentFacts(
      "# 安装说明\n\n本文介绍如何安装客户端。\n下载包之后按提示下一步即可。",
    );
    assert.equal(facts.title, "安装说明");
    assert.ok(facts.sentences.some((s) => /本文介绍如何安装/.test(s)));
  });

  it("reads a local public page over HTTP", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
      res.end("# 本地夹具\n\n这一章只用来证明本机 HTTP 抓取。\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    try {
      const href = `http://127.0.0.1:${addr.port}/fixture.md`;
      const doc = await readPublicDocument(`读一下 ${href} 这个文档`);
      assert.ok(doc);
      assert.equal(doc.title, "本地夹具");
      assert.match(doc.text, /本机 HTTP 抓取/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
