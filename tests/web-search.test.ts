import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { decodeHtmlEntities, parseBingHtml, parseWikipediaArticle, searchWeb, stripHtml } from "../src/web-search.js";
import { freePort } from "./helpers.js";

function rewriteFetch(port: number, seen: string[]): typeof fetch {
  return async (input, init) => {
    const original = String(input);
    seen.push(original);
    const u = new URL(original);
    const mapped = new URL(u.pathname + u.search, `http://127.0.0.1:${port}`);
    return fetch(mapped, init);
  };
}

describe("web search", () => {
  it("TC-SEARCH-001: calls DuckDuckGo and Wikipedia over HTTP, not the workspace", async () => {
    const port = await freePort();
    const requested: string[] = [];
    const server = http.createServer((req, res) => {
      requested.push(`${req.method} ${req.url}`);
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      const send = (body: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/" && url.searchParams.get("format") === "json") {
        send({
          Heading: "Grok",
          AbstractText: "Grok is a generative AI chatbot developed by xAI.",
          AbstractURL: "https://en.wikipedia.org/wiki/Grok_(chatbot)",
          RelatedTopics: [],
        });
        return;
      }
      if (url.pathname === "/w/api.php") {
        send({
          query: {
            search: [{ title: "Grok (chatbot)", snippet: "Grok is a <span>chatbot</span> by xAI." }],
          },
        });
        return;
      }
      if (url.pathname.startsWith("/api/rest_v1/page/summary/")) {
        send({
          title: "Grok (chatbot)",
          extract: "Grok is a generative artificial intelligence chatbot developed by xAI.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Grok_(chatbot)" } },
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const seen: string[] = [];
    try {
      const hits = await searchWeb("Grok Bot", { fetch: rewriteFetch(port, seen), timeoutMs: 3000 });
      assert.ok(seen.some((u) => u.startsWith("https://api.duckduckgo.com/")));
      assert.ok(seen.some((u) => /https:\/\/(en|zh)\.wikipedia\.org\//.test(u)));
      assert.ok(!seen.some((u) => /workspace\/project|127\.0\.0\.1:8000/.test(u)));
      assert.ok(requested.some((r) => r.includes("format=json")));
      assert.ok(hits.length >= 1);
      assert.ok(hits.some((h) => /xAI|chatbot/i.test(h.snippet)));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("TC-SEARCH-003: empty query and failed HTTP return no hits", async () => {
    assert.deepEqual(await searchWeb("  "), []);
    const fetchFn: typeof fetch = async () => {
      throw new Error("offline");
    };
    const hits = await searchWeb("Grok Bot", { fetch: fetchFn, timeoutMs: 200 });
    assert.deepEqual(hits, []);
  });

  it("TC-SEARCH-004: empty search APIs fall back to fetching the Bing result page", async () => {
    const port = await freePort();
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname === "/search") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<ol><li class="b_algo"><h2><a href="https://example.com/grok">Grok Bot</a></h2>` +
            `<p class="b_lineclamp2">Grok Bot is a team of always-on agents with their own computer.</p></li></ol>`,
        );
        return;
      }
      if (url.searchParams.get("format") === "json" || url.pathname === "/w/api.php") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ AbstractText: "", RelatedTopics: [], query: { search: [] } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const seen: string[] = [];
    try {
      const hits = await searchWeb("Grok Bot", { fetch: rewriteFetch(port, seen), timeoutMs: 3000 });
      assert.ok(seen.some((u) => /bing\.com\/search/.test(u)));
      assert.ok(hits.some((h) => h.source === "bing" && /always-on agents/i.test(h.snippet)));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("TC-SEARCH-005: empty APIs fall back to reading a Wikipedia article page", async () => {
    const port = await freePort();
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith("/wiki/")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<h1>Grok (chatbot)</h1><div class="mw-parser-output"><p>Grok is a generative artificial intelligence chatbot developed by xAI.</p></div>`,
        );
        return;
      }
      if (url.searchParams.get("format") === "json" || url.pathname === "/w/api.php" || url.pathname === "/search") {
        res.writeHead(200, { "Content-Type": url.pathname === "/search" ? "text/html" : "application/json" });
        res.end(url.pathname === "/search" ? "<html></html>" : JSON.stringify({ AbstractText: "", query: { search: [] } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const seen: string[] = [];
    try {
      const hits = await searchWeb("Grok Bot", { fetch: rewriteFetch(port, seen), timeoutMs: 3000 });
      assert.ok(seen.some((u) => /wikipedia\.org\/wiki\//.test(u)));
      assert.ok(hits.some((h) => /chatbot developed by xAI/i.test(h.snippet)));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("TC-SEARCH-007: a Chinese question prefers zh Wikipedia and cn.bing", async () => {
    const port = await freePort();
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname === "/w/api.php") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            query: { search: [{ title: "Grok", snippet: "Grok 是 xAI 做的聊天机器人。" }] },
          }),
        );
        return;
      }
      if (url.pathname.startsWith("/api/rest_v1/page/summary/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            title: "Grok",
            extract: "Grok 是 xAI 开发的生成式对话机器人。",
            content_urls: { desktop: { page: "https://zh.wikipedia.org/wiki/Grok" } },
          }),
        );
        return;
      }
      if (url.searchParams.get("format") === "json" || url.pathname === "/search") {
        res.writeHead(200, { "Content-Type": url.pathname === "/search" ? "text/html" : "application/json" });
        res.end(url.pathname === "/search" ? "<html></html>" : JSON.stringify({ AbstractText: "", RelatedTopics: [] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const seen: string[] = [];
    try {
      const hits = await searchWeb("Grok Bot", {
        fetch: rewriteFetch(port, seen),
        timeoutMs: 3000,
        preferChinese: true,
      });
      assert.ok(seen.some((u) => u.startsWith("https://zh.wikipedia.org/")));
      assert.ok(seen.some((u) => u.startsWith("https://cn.bing.com/")));
      assert.ok(hits.some((h) => /对话|聊天|机器人/.test(h.snippet)));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("parses Bing and Wikipedia public pages into hits", () => {
    const bing = parseBingHtml(
      `<li class="b_algo"><h2><a href="https://example.com">Grok</a></h2><p>Grok is a chatbot by xAI.</p></li>`,
    );
    assert.equal(bing[0]?.snippet.includes("chatbot"), true);
    const wiki = parseWikipediaArticle(
      `<h1>Grok</h1><p>Grok is a generative artificial intelligence chatbot developed by xAI.</p>`,
    );
    assert.match(wiki?.snippet || "", /xAI/);
    assert.equal(decodeHtmlEntities("2026年8月13日&ensp; &ensp;Grok"), "2026年8月13日   Grok");
    assert.doesNotMatch(stripHtml("2026年8月13日&ensp;&ensp;教程"), /&ensp;/);
  });
});
