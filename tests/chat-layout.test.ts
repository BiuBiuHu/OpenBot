import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/config.js";
import { repoRoot } from "../src/paths.js";
import { startControlPlane } from "../src/server.js";
import { freePort } from "./helpers.js";

const pagePath = path.join(repoRoot(), "src/ui/index.html");

describe("chat column scroll", () => {
  it("TC-UI-SCROLL-001: the composer lives in the chat column, under its own scroller", () => {
    const html = fs.readFileSync(pagePath, "utf8");
    const chatAt = html.indexOf('<section class="chat-col">');
    const logAt = html.indexOf('<section id="log">');
    const footerAt = html.indexOf("<footer>");
    const asideAt = html.indexOf("<aside>");
    assert.ok(chatAt > 0 && logAt > chatAt && footerAt > logAt && asideAt > footerAt);
    const chatClose = html.lastIndexOf("</section>", asideAt);
    assert.ok(chatClose > footerAt, "chat column must close after the composer and before the computer column");
    const logCss = (html.match(/#log\s*\{[^}]+\}/) || [])[0] || "";
    assert.match(logCss, /min-height:\s*0/);
    assert.match(logCss, /overflow-y:\s*auto/);
    assert.match(html, /height:\s*100dvh/);
    assert.match(html, /max-height:\s*100dvh/);
    assert.match(html, /grid-template-rows:\s*auto minmax\(0,\s*1fr\)/);
    const footerCss = (html.match(/footer\s*\{[^}]+\}/) || [])[0] || "";
    assert.match(footerCss, /flex:\s*0 0 auto/);
    assert.doesNotMatch(footerCss, /position:\s*(?:fixed|sticky)/);
  });

  it("TC-UI-SCROLL-002: a long thread scrolls inside the chat column and leaves the computer column put", async () => {
    const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome-stable";
    assert.equal(fs.existsSync(chrome), true, `chrome required for layout check: ${chrome}`);
    const config = defaultConfig();
    config.controlPlane.port = await freePort();
    config.host.hostname = "";
    const plane = await startControlPlane(config, { skipTunnel: true, allowWithoutWorker: true });
    const browser = await launchChrome(chrome);
    try {
      const url = `http://127.0.0.1:${config.controlPlane.port}/`;
      const wide = await browser.measure(url, 1440, 900);
      assert.equal(wide.logScrolls, true, JSON.stringify(wide));
      assert.equal(wide.canScrollToTop, true, JSON.stringify(wide));
      assert.equal(wide.footerBelowLog, true, JSON.stringify(wide));
      assert.equal(wide.footerInsideChat, true, JSON.stringify(wide));
      assert.equal(wide.inputDoesNotCoverLog, true, JSON.stringify(wide));
      assert.equal(wide.lastMessageAboveInput, true, JSON.stringify(wide));
      assert.equal(wide.asideStays, true, JSON.stringify(wide));
      assert.equal(wide.asideBesideChat, true, JSON.stringify(wide));
      assert.equal(wide.pageFixed, true, JSON.stringify(wide));
      const narrow = await browser.measure(url, 800, 900);
      assert.equal(narrow.asideHidden, true, JSON.stringify(narrow));
      assert.equal(narrow.logScrolls, true, JSON.stringify(narrow));
      assert.equal(narrow.canScrollToTop, true, JSON.stringify(narrow));
      assert.equal(narrow.footerBelowLog, true, JSON.stringify(narrow));
      assert.equal(narrow.inputDoesNotCoverLog, true, JSON.stringify(narrow));
      assert.equal(narrow.lastMessageAboveInput, true, JSON.stringify(narrow));
      assert.equal(narrow.pageFixed, true, JSON.stringify(narrow));
    } finally {
      await browser.close();
      await plane.close();
    }
  });
});

interface LayoutMetrics {
  logScrolls: boolean;
  canScrollToTop: boolean;
  footerBelowLog: boolean;
  footerInsideChat: boolean;
  inputDoesNotCoverLog: boolean;
  lastMessageAboveInput: boolean;
  asideStays: boolean;
  asideBesideChat: boolean;
  asideHidden: boolean;
  pageFixed: boolean;
}

async function launchChrome(chrome: string): Promise<{
  measure(url: string): Promise<LayoutMetrics>;
  close(): Promise<void>;
}> {
  const port = await freePort();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-chrome-"));
  const child: ChildProcess = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const version = (await waitJson(`http://127.0.0.1:${port}/json/version`)) as { webSocketDebuggerUrl: string };
  const browserWs = new WebSocket(version.webSocketDebuggerUrl);
  await waitOpen(browserWs);
  const browser = cdp(browserWs);
  const created = (await browser.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
  const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
    id: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = list.find((item) => item.id === created.targetId);
  if (!page) throw new Error("chrome page target missing");
  const pageWs = new WebSocket(page.webSocketDebuggerUrl);
  await waitOpen(pageWs);
  const session = cdp(pageWs);

  return {
    async measure(url: string, width: number, height: number) {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await session.send("Page.enable");
      await session.send("Page.navigate", { url });
      await waitReady(session);
      const evaluated = (await session.send("Runtime.evaluate", {
        expression: layoutProbe,
        returnByValue: true,
        awaitPromise: true,
      })) as { result?: { value?: LayoutMetrics }; exceptionDetails?: unknown };
      if (evaluated.exceptionDetails || !evaluated.result?.value) {
        throw new Error(`layout probe failed: ${JSON.stringify(evaluated.exceptionDetails || evaluated)}`);
      }
      return evaluated.result.value;
    },
    async close() {
      pageWs.close();
      browserWs.close();
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      fs.rmSync(userData, { recursive: true, force: true });
    },
  };
}

function cdp(ws: WebSocket): { send(method: string, params?: object): Promise<unknown> } {
  let seq = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } };
    if (!msg.id || !pending.has(msg.id)) return;
    const waiter = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message || "cdp error"));
    else waiter.resolve(msg.result);
  });
  return {
    send(method, params) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function waitReady(session: { send(method: string, params?: object): Promise<unknown> }): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const evaluated = (await session.send("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    })) as { result?: { value?: string } };
    if (evaluated.result?.value === "complete" && (await hasChat(session))) return;
    await sleep(100);
  }
  throw new Error("page did not finish loading");
}

async function hasChat(session: { send(method: string, params?: object): Promise<unknown> }): Promise<boolean> {
  const evaluated = (await session.send("Runtime.evaluate", {
    expression: "!!document.querySelector('.chat-col') && !!document.getElementById('log')",
    returnByValue: true,
  })) as { result?: { value?: boolean } };
  return evaluated.result?.value === true;
}

async function waitJson(url: string): Promise<unknown> {
  let last = "unavailable";
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = `${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(100);
  }
  throw new Error(`chrome debugger did not answer: ${last}`);
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("chrome websocket failed")), { once: true });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const layoutProbe = `(() => {
  const log = document.getElementById("log");
  const footer = document.querySelector(".chat-col footer");
  const aside = document.querySelector("aside");
  const chat = document.querySelector(".chat-col");
  const box = document.getElementById("box");
  for (let i = 0; i < 30; i++) {
    const el = document.createElement("article");
    el.className = i % 2 ? "msg user" : "msg bot";
    el.innerHTML = '<div class="bubble"><div class="md">第 ' + i + ' 句。这是用来把左边聊天列撑高的正文，应该能单独往上翻，而不是被输入框盖住。</div></div>';
    log.appendChild(el);
  }
  const asideBefore = aside.getBoundingClientRect();
  const pageBefore = window.scrollY;
  log.scrollTop = log.scrollHeight;
  const atBottom = log.scrollTop;
  log.scrollTop = 0;
  const atTop = log.scrollTop;
  const logBox = log.getBoundingClientRect();
  const footBox = footer.getBoundingClientRect();
  const chatBox = chat.getBoundingClientRect();
  const asideBox = aside.getBoundingClientRect();
  const boxBox = box.getBoundingClientRect();
  log.scrollTop = log.scrollHeight;
  const last = log.lastElementChild.getBoundingClientRect();
  const logAfter = log.getBoundingClientRect();
  return {
    logScrolls: log.scrollHeight > log.clientHeight + 20,
    canScrollToTop: atBottom > 40 && atTop === 0,
    footerBelowLog: footBox.top >= logBox.bottom - 1,
    footerInsideChat: footBox.left >= chatBox.left - 1 && footBox.right <= chatBox.right + 1,
    inputDoesNotCoverLog: boxBox.top >= logBox.bottom - 1,
    lastMessageAboveInput: last.bottom <= logAfter.bottom + 1 && last.bottom <= footBox.top + 1,
    asideStays: !aside || asideBox.width === 0 || (Math.abs(asideBox.top - asideBefore.top) < 1 && Math.abs(asideBox.left - asideBefore.left) < 1),
    asideBesideChat: !!aside && asideBox.width > 0 && asideBox.left >= chatBox.right - 2,
    asideHidden: !aside || asideBox.width === 0,
    pageFixed: window.scrollY === pageBefore && document.body.scrollHeight <= window.innerHeight + 4,
  };
})()`;
