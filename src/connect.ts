import {
  identityFileMissing,
  nextStepForConnect,
} from "./config.js";
import { OpenHandsClient } from "./oh-client.js";
import { probeSsh } from "./ssh.js";
import type { OpenBotConfig } from "./types.js";
import { openHandsLocalPort, openLocalForward, type TunnelHandle } from "./tunnel.js";

export interface ConnectResult {
  ssh: { ok: boolean; uname?: string; error?: string };
  openhands: { ok: boolean; error?: string };
  tunnel?: TunnelHandle;
  ready: boolean;
  nextStep: string;
}

function isLoopback(hostname: string): boolean {
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
  if (!ohProbe.ok && hasHost && !isLoopback(config.host.hostname) && !opts.skipTunnel) {
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
  const guide = nextStepForConnect({
    hasHost,
    identityFile: config.host.identityFile,
    identityMissing: identityFileMissing(config),
    sshOk: ssh.ok || openhands.ok,
    ohOk: openhands.ok,
    hasSessionKey: Boolean(config.openhands.sessionApiKey),
    sshError: ssh.error,
  });
  return { ssh, openhands, tunnel, ready: guide.ready, nextStep: guide.nextStep };
}
