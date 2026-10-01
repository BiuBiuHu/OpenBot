import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { searchWeb } from "../src/web-search.js";
import { freePort } from "./helpers.js";

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
    const fetchFn: typeof fetch = async (input, init) => {
      const original = String(input);
      seen.push(original);
      const u = new URL(original);
      const mapped = new URL(u.pathname + u.search, `http://127.0.0.1:${port}`);
      return fetch(mapped, init);
    };
    try {
      const hits = await searchWeb("Grok Bot", { fetch: fetchFn, timeoutMs: 3000 });
      assert.ok(seen.some((u) => u.startsWith("https://api.duckduckgo.com/")));
      assert.ok(seen.some((u) => /https:\/\/(en|zh)\.wikipedia\.org\//.test(u)));
      assert.ok(!seen.some((u) => /workspace\/project|127\.0\.0\.1:8000/.test(u)));
      assert.ok(requested.some((r) => r.includes("format=json")));
      assert.ok(hits.length >= 1);
      assert.ok(hits.some((h) => /xAI|chatbot/i.test(h.snippet)));
      assert.ok(hits.every((h) => h.source === "duckduckgo" || h.source === "wikipedia"));
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
});
