import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import {
  extractDocumentFacts,
  extractPublicHttpUrl,
  githubReadmeRawUrls,
  isDocumentReadAsk,
  isGithubRepoHome,
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
    assert.equal(
      isDocumentReadAsk("那这个项目 https://github.com/bojieli/ai-agent-book 讲了什么?"),
      true,
    );
    assert.equal(isGithubRepoHome("https://github.com/bojieli/ai-agent-book"), true);
    assert.equal(isGithubRepoHome("https://github.com/bojieli/ai-agent-book/"), true);
    assert.equal(
      isGithubRepoHome("https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md"),
      false,
    );
  });

  it("TC-DOC-002: GitHub blob pages rewrite to raw.githubusercontent.com", () => {
    assert.equal(
      readableDocumentUrl("https://github.com/bojieli/ai-agent-book/blob/main/book/chapter3.md"),
      "https://raw.githubusercontent.com/bojieli/ai-agent-book/main/book/chapter3.md",
    );
    assert.equal(readableDocumentUrl("https://example.com/notes.md"), "https://example.com/notes.md");
    assert.deepEqual(githubReadmeRawUrls("https://github.com/bojieli/ai-agent-book"), [
      "https://raw.githubusercontent.com/bojieli/ai-agent-book/HEAD/README.md",
      "https://raw.githubusercontent.com/bojieli/ai-agent-book/main/README.md",
      "https://raw.githubusercontent.com/bojieli/ai-agent-book/master/README.md",
    ]);
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

  it("TC-DOC-008: a GitHub repo URL reads README raw, not the HTML shell", async () => {
    const requested: string[] = [];
    const readme =
      "# 深入理解 AI Agent：设计原理与工程实践\n\n本书围绕 Agent = LLM + 上下文 + 工具，把智能体从原理讲到工程实战。\n";
    const doc = await readPublicDocument("那这个项目 https://github.com/bojieli/ai-agent-book 讲了什么?", {
      fetch: async (input) => {
        requested.push(String(input));
        if (String(input).includes("raw.githubusercontent.com") && /README\.md$/i.test(String(input))) {
          return new Response(readme, { status: 200, headers: { "content-type": "text/markdown" } });
        }
        return new Response("<html>模型选型可参考这篇指南</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    });
    assert.ok(doc);
    assert.equal(doc.kind, "repo");
    assert.equal(doc.title, "深入理解 AI Agent：设计原理与工程实践");
    assert.doesNotMatch(doc.text, /模型选型可参考/);
    assert.ok(requested.some((u) => /raw\.githubusercontent\.com\/bojieli\/ai-agent-book\/.+\/README\.md/.test(u)));
    assert.ok(!requested.includes("https://github.com/bojieli/ai-agent-book"));
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
