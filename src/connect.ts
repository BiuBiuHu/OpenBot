import {
  identityFileMissing,
  nextStepForConnect,
} from "./config.js";
import { openDesktopForward, probeDesktop, type DesktopStatus } from "./desktop.js";
import { OpenHandsClient } from "./oh-client.js";
import { probeSsh } from "./ssh.js";
import type { OpenBotConfig } from "./types.js";
import { openHandsLocalPort, openLocalForward, type TunnelHandle } from "./tunnel.js";

export interface ConnectResult {
  ssh: { ok: boolean; uname?: string; error?: string };
  openhands: { ok: boolean; error?: string };
  desktop: DesktopStatus;
  tunnel?: TunnelHandle;
  desktopTunnel?: TunnelHandle;
  ready: boolean;
  nextStep: string;
}

export function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export async function connectConfiguredHost(
  config: OpenBotConfig,
  opts: {
    timeoutMs?: number;
    existing?: TunnelHandle;
    skipSsh?: boolean;
    skipTunnel?: boolean;
  } = {},
): Promise<ConnectResult> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const connectTimeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  let tunnel = opts.existing;
  let desktopTunnel: TunnelHandle | undefined;
  let ssh: ConnectResult["ssh"] = { ok: false };
  const hasHost = Boolean(config.host.hostname);

  if (!hasHost) {
    ssh = { ok: false };
  } else if (opts.skipSsh || isLoopback(config.host.hostname)) {
    ssh = { ok: true };
  } else {
    try {
      const uname = await probeSsh(config, { timeoutMs, connectTimeoutSec });
      ssh = { ok: true, uname };
    } catch (err) {
      ssh = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const client = OpenHandsClient.fromConfig(config);
  let ohProbe = await client.health();
  if (hasHost && !isLoopback(config.host.hostname) && !ssh.ok) {
    ohProbe = {
      ok: false,
      raw: { error: ssh.error || "SSH is down; not using a leftover local OpenHands" },
    };
  } else if (!ohProbe.ok && hasHost && !isLoopback(config.host.hostname) && !opts.skipTunnel) {
    try {
      if (tunnel) await tunnel.stop();
      tunnel = await openLocalForward(config, {
        localPort: openHandsLocalPort(config.openhands.baseUrl),
        remotePort: 8000,
        connectTimeoutSec,
      });
      ohProbe = await client.health();
    } catch (err) {
      tunnel = undefined;
      if (!ohProbe.ok) {
        ohProbe = {
          ok: false,
          raw: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }
  }

  const openhands = {
    ok: ohProbe.ok,
    error: ohProbe.ok ? undefined : ((ohProbe.raw as { error?: string })?.error || "not reachable"),
  };
  if (hasHost && !isLoopback(config.host.hostname) && ssh.ok && !opts.skipTunnel) {
    try {
      desktopTunnel = await openDesktopForward(config, { connectTimeoutSec });
    } catch {
      desktopTunnel = undefined;
    }
  }
  const desktop = await probeDesktop(config, { sshOk: ssh.ok, timeoutMs: Math.min(800, timeoutMs) });
  const guide = nextStepForConnect({
    hasHost,
    identityFile: config.host.identityFile,
    identityMissing: identityFileMissing(config),
    sshOk: ssh.ok,
    ohOk: openhands.ok,
    hasSessionKey: Boolean(config.openhands.sessionApiKey),
    sshError: ssh.error,
  });
  return { ssh, openhands, desktop, tunnel, desktopTunnel, ready: guide.ready, nextStep: guide.nextStep };
}
