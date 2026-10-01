import net from "node:net";
import type { OpenBotConfig } from "./types.js";
import { openLocalForward, type TunnelHandle } from "./tunnel.js";

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
    return { ok: true, viewerUrl, localPort, remotePort };
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
