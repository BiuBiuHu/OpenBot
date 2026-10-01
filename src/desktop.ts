import http from "node:http";
import net from "node:net";
import type { OpenBotConfig } from "./types.js";
import { openLocalForward, type TunnelHandle } from "./tunnel.js";

/** Same-origin wrapper. The iframe loads this, not the raw noVNC URL. */
export const DESKTOP_EMBED_PATH = "/desktop-view";

/** Default Openbox framebuffer on the host. Scale this; do not resize the ECS. */
export const DESKTOP_FRAME_WIDTH = 1280;
export const DESKTOP_FRAME_HEIGHT = 800;

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export interface DesktopStatus {
  ok: boolean;
  viewerUrl?: string;
  localPort: number;
  remotePort: number;
  missing?: string;
}

export function desktopLocalPort(config: OpenBotConfig): number {
  return config.desktop?.localPort || 6080;
}

export function desktopRemotePort(config: OpenBotConfig): number {
  return config.desktop?.remotePort || config.desktop?.localPort || 6080;
}

export function desktopMissingLine(kind: "ssh" | "tcp" | "http" | "no-host"): string {
  if (kind === "no-host") {
    return "Desktop waits on Settings. Set host, user, port, and a key path first.";
  }
  if (kind === "ssh") {
    return "SSH is down, so the desktop tunnel is not open.";
  }
  if (kind === "tcp") {
    return "The desktop tunnel to 127.0.0.1:6080 is not open yet. Save and connect; the client will retry the forward.";
  }
  return "Tunnel reached the port, but no web VNC page answered on 127.0.0.1 (default 6080).";
}

export function desktopViewerPaths(): string[] {
  return [
    "/vnc.html?autoconnect=1&resize=scale",
    "/vnc.html",
    "/vnc_lite.html?autoconnect=1",
    "/vnc_lite.html",
    "/",
  ];
}

export function desktopTunnelLive(tunnel?: TunnelHandle): boolean {
  return Boolean(tunnel && tunnel.process.exitCode === null);
}

async function tcpOpen(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      done(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

async function httpViewer(port: number, timeoutMs: number): Promise<string | undefined> {
  for (const path of desktopViewerPaths()) {
    const url = `http://127.0.0.1:${port}${path}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return url;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export async function probeDesktop(
  config: OpenBotConfig,
  opts: { timeoutMs?: number; sshOk?: boolean } = {},
): Promise<DesktopStatus> {
  const timeoutMs = opts.timeoutMs ?? 800;
  const localPort = desktopLocalPort(config);
  const remotePort = desktopRemotePort(config);
  const hostname = config.host.hostname || "";
  const remote = Boolean(hostname) && !isLoopback(hostname);
  if (remote && opts.sshOk === false) {
    return { ok: false, localPort, remotePort, missing: desktopMissingLine("ssh") };
  }
  const viewerUrl = await httpViewer(localPort, timeoutMs);
  if (viewerUrl) {
    return { ok: true, viewerUrl: DESKTOP_EMBED_PATH, localPort, remotePort };
  }
  if (await tcpOpen(localPort, timeoutMs)) {
    return { ok: false, localPort, remotePort, missing: desktopMissingLine("http") };
  }
  if (!hostname) {
    return { ok: false, localPort, remotePort, missing: desktopMissingLine("no-host") };
  }
  return { ok: false, localPort, remotePort, missing: desktopMissingLine("tcp") };
}

/** Re-probe. If SSH is up and the 6080 forward is missing, open it and probe again. */
export async function refreshDesktopStatus(
  config: OpenBotConfig,
  opts: {
    timeoutMs?: number;
    sshOk?: boolean;
    tunnel?: TunnelHandle;
    openForward?: () => Promise<TunnelHandle>;
  } = {},
): Promise<{ desktop: DesktopStatus; tunnel?: TunnelHandle }> {
  const timeoutMs = opts.timeoutMs ?? 800;
  let tunnel = opts.tunnel;
  let desktop = await probeDesktop(config, { timeoutMs, sshOk: opts.sshOk });
  if (desktop.ok) return { desktop, tunnel };

  const hostname = config.host.hostname || "";
  const remote = Boolean(hostname) && !isLoopback(hostname);
  if (opts.sshOk && remote && opts.openForward && !desktopTunnelLive(tunnel)) {
    try {
      tunnel = await opts.openForward();
    } catch {
      /* keep the first probe */
    }
  }

  if (!desktop.ok && (desktopTunnelLive(tunnel) || !remote)) {
    desktop = await probeDesktop(config, {
      timeoutMs: Math.max(timeoutMs, 1200),
      sshOk: opts.sshOk,
    });
  }
  return { desktop, tunnel };
}

export function injectDesktopViewer(html: string, opts: { showBar?: boolean } = {}): string {
  const showBar = Boolean(opts.showBar);
  const fill =
    `html,body,#noVNC_container{width:100%!important;height:100%!important;margin:0!important;overflow:visible!important;background:#111!important;border-radius:0!important}
     #noVNC_container{position:fixed!important;inset:0!important}
     #noVNC_container canvas{border-radius:0!important}`;
  const css = showBar
    ? fill
    : `${fill}
       #noVNC_control_bar_anchor,#noVNC_control_bar,#noVNC_control_bar_handle,
       #noVNC_status,#noVNC_status_bar,#noVNC_hint_anchor,#noVNC_transition,
       .noVNC_panel{display:none!important;visibility:hidden!important}`;
  const js = `(function(){
    function fit(){
      try{
        var rfb=window.UI&&UI.rfb;
        if(rfb){
          rfb.scaleViewport=true;
          rfb.clipViewport=false;
          rfb.resizeSession=false;
        }
        if(window.UI&&UI.updateViewSetting){try{UI.updateViewSetting();}catch(e){}}
        window.dispatchEvent(new Event("resize"));
      }catch(e){}
    }
    window.addEventListener("load",function(){fit();setTimeout(fit,300);setTimeout(fit,1200);});
    window.addEventListener("resize",fit);
    setInterval(fit,2000);
  })();`;
  const snippet = `<style id="openbot-desk-fit">${css}</style><script id="openbot-desk-fit-js">${js}</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}</head>`);
  return `${snippet}${html}`;
}

export function novncProxyPath(pathname: string): string {
  const raw = decodeURIComponent(String(pathname || "").replace(/^\/novnc/, "") || "/");
  if (raw.includes("..")) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export async function proxyDesktopViewer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  localPort: number,
): Promise<void> {
  const incoming = new URL(req.url || "/", "http://127.0.0.1");
  const rel = novncProxyPath(incoming.pathname);
  const dest = new URL(rel, `http://127.0.0.1:${localPort}`);
  dest.search = incoming.search;
  if (dest.hostname !== "127.0.0.1" && dest.hostname !== "localhost") {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("loopback only");
    return;
  }
  if (/vnc[^/]*\.html$/i.test(dest.pathname) || dest.pathname === "/") {
    dest.searchParams.set("autoconnect", dest.searchParams.get("autoconnect") || "1");
    dest.searchParams.set("resize", dest.searchParams.get("resize") || "scale");
    dest.searchParams.set("reconnect", dest.searchParams.get("reconnect") || "1");
    dest.searchParams.set("encrypt", dest.searchParams.get("encrypt") || "0");
    dest.searchParams.set("host", "127.0.0.1");
    dest.searchParams.set("port", String(localPort));
  }
  const up = await fetch(dest, {
    headers: {
      Accept: String(req.headers.accept || "*/*"),
      "User-Agent": String(req.headers["user-agent"] || "OpenBot-desktop"),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  });
  const type = up.headers.get("content-type") || "";
  const buf = Buffer.from(await up.arrayBuffer());
  if (type.includes("text/html")) {
    const showBar = incoming.searchParams.get("bar") === "1";
    res.writeHead(up.status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(injectDesktopViewer(buf.toString("utf8"), { showBar }));
    return;
  }
  res.writeHead(up.status, { "Content-Type": type || "application/octet-stream" });
  res.end(buf);
}

export async function openDesktopForward(
  config: OpenBotConfig,
  opts: { connectTimeoutSec?: number; existing?: TunnelHandle } = {},
): Promise<TunnelHandle> {
  if (opts.existing) await opts.existing.stop();
  return openLocalForward(config, {
    localPort: desktopLocalPort(config),
    remotePort: desktopRemotePort(config),
    connectTimeoutSec: opts.connectTimeoutSec,
  });
}
