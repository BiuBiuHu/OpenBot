import assert from "node:assert/strict";
import http from "node:http";
import { after, describe, it } from "node:test";
import { defaultConfig } from "../src/config.js";
import { desktopMissingLine, probeDesktop } from "../src/desktop.js";
import { startControlPlane } from "../src/server.js";
import { freePort } from "./helpers.js";
import { startMockOhServer } from "./oh-mock.js";

describe("desktop pane (no live host)", () => {
  it("TC-DESK-001: missing line is one sentence and names no host", () => {
    for (const kind of ["ssh", "tcp", "http", "no-host"] as const) {
      const line = desktopMissingLine(kind);
      assert.ok(line.length < 180);
      assert.doesNotMatch(line, /\b(?!127\.0\.0\.1)(?:\d{1,3}\.){3}\d{1,3}\b/);
      assert.doesNotMatch(line, /BEGIN /);
    }
  });

  it("TC-DESK-002: leftover local OpenHands does not make a remote desktop ready", async () => {
    const config = defaultConfig();
    config.host.hostname = "192.0.2.10";
    config.host.user = "demo";
    const status = await probeDesktop(config, { sshOk: false, timeoutMs: 200 });
    assert.equal(status.ok, false);
    assert.match(String(status.missing), /SSH/);
    assert.equal(status.viewerUrl, undefined);
  });

  it("TC-DESK-003: /api/desktop reports a local viewer when noVNC answers on the tunneled port", async () => {
    const port = await freePort();
    const vnc = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><title>noVNC</title></html>");
    });
    await new Promise<void>((resolve) => vnc.listen(port, "127.0.0.1", resolve));
    const mock = await startMockOhServer({ sessionKey: "desk-key" });
    const config = defaultConfig();
    config.controlPlane.port = await freePort();
    config.openhands.baseUrl = mock.baseUrl;
    config.openhands.sessionApiKey = "desk-key";
    config.desktop.localPort = port;
    config.desktop.remotePort = port;
    const plane = await startControlPlane(config, { skipTunnel: true, allowWithoutWorker: true });
    try {
      const desk = (await (await fetch(`http://127.0.0.1:${config.controlPlane.port}/api/desktop`)).json()) as {
        ok?: boolean;
        viewerUrl?: string;
        missing?: string;
      };
      assert.equal(desk.ok, true);
      assert.match(String(desk.viewerUrl), /127\.0\.0\.1/);
      const html = await (await fetch(`http://127.0.0.1:${config.controlPlane.port}/`)).text();
      assert.match(html, /电脑/);
      assert.match(html, /id="desk"/);
      assert.doesNotMatch(html, /On this computer/);
    } finally {
      await plane.close();
      await mock.stop();
      await new Promise<void>((resolve) => vnc.close(() => resolve()));
    }
  });
});
