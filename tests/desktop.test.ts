import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/config.js";
import {
  DESKTOP_EMBED_PATH,
  desktopMissingLine,
  injectDesktopViewer,
  probeDesktop,
  refreshDesktopStatus,
} from "../src/desktop.js";
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
      assert.doesNotMatch(line, /start a desktop/i);
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
      assert.equal(desk.viewerUrl, DESKTOP_EMBED_PATH);
      const html = await (await fetch(`http://127.0.0.1:${config.controlPlane.port}/`)).text();
      assert.match(html, /电脑/);
      assert.match(html, /id="desk"/);
      assert.match(html, /desk-wrap/);
      assert.match(html, /aspect-ratio:\s*1280\s*\/\s*800/);
      assert.match(html, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*28rem/);
      assert.match(html, /id="desk-bar"/);
      assert.match(html, /工具条/);
      assert.match(html, /allow-pointer-lock/);
      assert.match(html, /pointer-lock/);
      assert.doesNotMatch(html, /On this computer/);
      assert.doesNotMatch(html, /start a desktop/i);
      const view = await (await fetch(`http://127.0.0.1:${config.controlPlane.port}/desktop-view`)).text();
      assert.match(view, /1280/);
      assert.match(view, /800/);
      assert.match(view, /scale\(" \+ sw \/ FRAME_W \+ "," \+ sh \/ FRAME_H \+ "\)/);
      const proxied = await (await fetch(`http://127.0.0.1:${config.controlPlane.port}/novnc/vnc.html`)).text();
      assert.match(proxied, /openbot-desk-fit/);
      assert.match(proxied, /noVNC_control_bar/);
      assert.match(proxied, /display:none/);
      assert.doesNotMatch(proxied, /\b(?!127\.0\.0\.1)(?:\d{1,3}\.){3}\d{1,3}\b/);
    } finally {
      await plane.close();
      await mock.stop();
      await new Promise<void>((resolve) => vnc.close(() => resolve()));
    }
  });

  it("TC-DESK-004: /api/desktop re-probes after a failed connect-time probe", async () => {
    const port = await freePort();
    const mock = await startMockOhServer({ sessionKey: "desk-retry" });
    const config = defaultConfig();
    config.controlPlane.port = await freePort();
    config.host.hostname = "127.0.0.1";
    config.host.user = "demo";
    config.openhands.baseUrl = mock.baseUrl;
    config.openhands.sessionApiKey = "desk-retry";
    config.desktop.localPort = port;
    config.desktop.remotePort = port;
    const plane = await startControlPlane(config, { skipTunnel: true, allowWithoutWorker: true });
    let vnc: http.Server | undefined;
    try {
      const first = (await (await fetch(`http://127.0.0.1:${config.controlPlane.port}/api/desktop`)).json()) as {
        ok?: boolean;
        missing?: string;
      };
      assert.equal(first.ok, false);
      assert.doesNotMatch(String(first.missing || ""), /start a desktop/i);
      vnc = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><title>noVNC</title></html>");
      });
      await new Promise<void>((resolve) => vnc.listen(port, "127.0.0.1", resolve));
      const second = (await (await fetch(`http://127.0.0.1:${config.controlPlane.port}/api/desktop`)).json()) as {
        ok?: boolean;
        viewerUrl?: string;
      };
      assert.equal(second.ok, true);
      assert.equal(second.viewerUrl, DESKTOP_EMBED_PATH);
    } finally {
      await plane.close();
      await mock.stop();
      if (vnc) await new Promise<void>((resolve) => vnc.close(() => resolve()));
    }
  });

  it("TC-DESK-005: refresh opens the 6080 forward when SSH is up and the tunnel is missing", async () => {
    const port = await freePort();
    const config = defaultConfig();
    config.host.hostname = "192.0.2.10";
    config.host.user = "demo";
    config.desktop.localPort = port;
    config.desktop.remotePort = 6080;
    let opened = 0;
    let vnc: http.Server | undefined;
    const status = await refreshDesktopStatus(config, {
      sshOk: true,
      timeoutMs: 250,
      openForward: async () => {
        opened += 1;
        vnc = http.createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><title>noVNC</title></html>");
        });
        await new Promise<void>((resolve) => vnc!.listen(port, "127.0.0.1", resolve));
        return {
          localPort: port,
          process: { exitCode: null } as import("node:child_process").ChildProcess,
          stop: async () => undefined,
        };
      },
    });
    try {
      assert.equal(opened, 1);
      assert.equal(status.desktop.ok, true);
      assert.equal(status.desktop.viewerUrl, DESKTOP_EMBED_PATH);
      const skipped = await refreshDesktopStatus(config, {
        sshOk: false,
        timeoutMs: 200,
        openForward: async () => {
          opened += 1;
          return {
            localPort: port,
            process: { exitCode: null } as import("node:child_process").ChildProcess,
            stop: async () => undefined,
          };
        },
      });
      assert.equal(opened, 1);
      assert.equal(skipped.desktop.ok, false);
      assert.match(String(skipped.desktop.missing), /SSH/);
    } finally {
      if (vnc) await new Promise<void>((resolve) => vnc.close(() => resolve()));
    }
  });

  it("TC-DESK-006: wrapper fills 1280x800 and hides the noVNC bar unless asked", () => {
    const hidden = injectDesktopViewer("<html><head></head><body><div id='noVNC_control_bar'></div></body></html>");
    assert.match(hidden, /openbot-desk-fit/);
    assert.match(hidden, /#noVNC_control_bar/);
    assert.match(hidden, /display:none/);
    assert.match(hidden, /scaleViewport=true/);
    assert.match(hidden, /resizeSession=false/);
    const shown = injectDesktopViewer("<html><head></head><body></body></html>", { showBar: true });
    assert.doesNotMatch(shown, /#noVNC_control_bar/);
  });
});
