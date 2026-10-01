import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "./types.js";
import { ensureDir, expandHome, openbotHome } from "./paths.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE = "https://api.openai.com/v1";

export function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadDotEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(openbotHome(), ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    Object.assign(merged, parseEnvFile(fs.readFileSync(file, "utf8")));
  }
  return merged;
}

function trimValue(value: string | undefined | null): string {
  return (value ?? "").trim();
}

/** True only for a non-empty local BYOK key. Empty/whitespace does not count. */
export function hasLocalModelKey(apiKey?: string | null): boolean {
  return Boolean(trimValue(apiKey));
}

/**
 * Process env wins when the key is present (including empty).
 * Else the dotenv file. Empty is explicit and must not fall through.
 */
function readEnv(env: Record<string, string>, key: string): string | undefined {
  if (Object.hasOwn(process.env, key)) {
    return trimValue(process.env[key]);
  }
  if (Object.hasOwn(env, key)) {
    return trimValue(env[key]);
  }
  return undefined;
}

function pick(env: Record<string, string>, key: string, fallback = ""): string {
  const value = readEnv(env, key);
  return value !== undefined ? value : fallback;
}

export function configPath(): string {
  return path.join(openbotHome(), "config.json");
}

export function defaultConfig(partial: Partial<OpenBotConfig> = {}): OpenBotConfig {
  const env = loadDotEnv();
  const host = partial.host;
  return {
    host: {
      name: host?.name || pick(env, "OPENBOT_HOST_NAME", "agent-pc"),
      hostname: host?.hostname || pick(env, "OPENBOT_HOST"),
      user: host?.user || pick(env, "OPENBOT_USER", process.env.USER || "ubuntu"),
      port: host?.port || Number(pick(env, "OPENBOT_PORT", "22")),
      identityFile: host?.identityFile || pick(env, "OPENBOT_IDENTITY_FILE") || undefined,
    },
    worker: {
      remotePort: partial.worker?.remotePort || Number(pick(env, "OPENBOT_WORKER_PORT", "3848")),
      localPort: partial.worker?.localPort || Number(pick(env, "OPENBOT_LOCAL_WORKER_PORT", "3848")),
      workspace: partial.worker?.workspace || pick(env, "OPENBOT_WORKSPACE", "~/openbot-workspace"),
      persist: partial.worker?.persist || "unknown",
      token: partial.worker?.token || "",
      remoteHome: partial.worker?.remoteHome || "~/.openbot-worker",
    },
    llm: {
      baseUrl: (partial.llm?.baseUrl || pick(env, "OPENAI_BASE_URL", DEFAULT_BASE)).replace(/\/$/, ""),
      model: partial.llm?.model || pick(env, "OPENAI_MODEL", DEFAULT_MODEL),
      // Empty OPENAI_API_KEY in the process or ~/.openbot/.env / .env
      // is explicit: do not keep a leftover key from config.json.
      apiKey: readEnv(env, "OPENAI_API_KEY") ?? trimValue(partial.llm?.apiKey),
    },
    controlPlane: {
      port: partial.controlPlane?.port || Number(pick(env, "OPENBOT_CONTROL_PORT", "3847")),
    },
    openhands: {
      baseUrl: (
        partial.openhands?.baseUrl ||
        pick(env, "OH_BASE_URL") ||
        pick(env, "OPENHANDS_BASE_URL", "http://127.0.0.1:8000")
      ).replace(/\/$/, ""),
      sessionApiKey:
        pick(env, "OH_SESSION_API_KEY") ||
        pick(env, "OPENHANDS_API_KEY") ||
        partial.openhands?.sessionApiKey ||
        "",
      workspaceDir:
        partial.openhands?.workspaceDir ||
        pick(env, "OPENHANDS_WORKSPACE", "workspace/project"),
      llmModel:
        readEnv(env, "OH_LLM_MODEL") ??
        readEnv(env, "OPENHANDS_LLM_MODEL") ??
        trimValue(partial.openhands?.llmModel),
      llmApiKey:
        readEnv(env, "OH_LLM_API_KEY") ??
        readEnv(env, "OPENHANDS_LLM_API_KEY") ??
        trimValue(partial.openhands?.llmApiKey),
      llmBaseUrl: (
        readEnv(env, "OH_LLM_BASE_URL") ??
        readEnv(env, "OPENHANDS_LLM_BASE_URL") ??
        trimValue(partial.openhands?.llmBaseUrl)
      ).replace(/\/$/, ""),
    },
  };
}

export function loadConfig(): OpenBotConfig {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return defaultConfig();
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<OpenBotConfig>;
  return defaultConfig(raw);
}

export function saveConfig(config: OpenBotConfig): string {
  const home = openbotHome();
  ensureDir(home);
  const file = configPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  return file;
}

export function writeEnvExampleToHome(): string {
  const home = openbotHome();
  ensureDir(home);
  const dest = path.join(home, ".env");
  if (!fs.existsSync(dest)) {
    const example = path.join(process.cwd(), ".env.example");
    const body = fs.existsSync(example)
      ? fs.readFileSync(example, "utf8")
      : "OPENAI_API_KEY=\nOPENAI_BASE_URL=https://api.openai.com/v1\nOPENAI_MODEL=gpt-4o-mini\n";
    fs.writeFileSync(dest, body, { mode: 0o600 });
  }
  return dest;
}

export function requireHost(config: OpenBotConfig): void {
  if (!config.host.hostname) {
    throw new Error(
      "No SSH host configured. Run `npx openbot init --host <ip> --user <name>` first.",
    );
  }
}

export function identityPath(config: OpenBotConfig): string | undefined {
  return config.host.identityFile ? expandHome(config.host.identityFile) : undefined;
}

/** Path only. Reject pasted PEM / OpenSSH private key material. */
export function assertIdentityPath(value: string): string {
  const trimmed = trimValue(value);
  if (!trimmed) return "";
  if (/BEGIN [A-Z0-9 ]*PRIVATE KEY/.test(trimmed) || trimmed.includes("-----") || /[\r\n]/.test(trimmed)) {
    throw new Error(
      "Point at a private key file path (for example ~/.ssh/id_ed25519). Do not paste the key.",
    );
  }
  return trimmed;
}

export function identityFileMissing(config: OpenBotConfig): boolean {
  const file = identityPath(config);
  if (!file) return false;
  return !fs.existsSync(file);
}

export function applyHostSettings(
  current: OpenBotConfig,
  input: {
    hostname?: string;
    user?: string;
    port?: number | string;
    identityFile?: string;
    name?: string;
  },
): OpenBotConfig {
  const identityFile =
    input.identityFile !== undefined
      ? assertIdentityPath(String(input.identityFile)) || undefined
      : current.host.identityFile;
  const rawPort = input.port !== undefined && input.port !== "" ? Number(input.port) : current.host.port;
  if (!Number.isFinite(rawPort) || rawPort < 1 || rawPort > 65535) {
    throw new Error("SSH port must be 1–65535");
  }
  return {
    ...current,
    host: {
      ...current.host,
      hostname: input.hostname !== undefined ? trimValue(input.hostname) : current.host.hostname,
      user: input.user !== undefined ? trimValue(input.user) || current.host.user : current.host.user,
      port: rawPort,
      identityFile,
      name: input.name !== undefined ? trimValue(input.name) || current.host.name : current.host.name,
    },
  };
}

export function publicSettings(config: OpenBotConfig) {
  return {
    host: {
      name: config.host.name,
      hostname: config.host.hostname,
      user: config.host.user,
      port: config.host.port,
      identityFile: config.host.identityFile || "",
    },
    openhands: {
      baseUrl: config.openhands.baseUrl,
      hasSessionKey: Boolean(config.openhands.sessionApiKey),
    },
    configPath: configPath(),
    envPath: path.join(openbotHome(), ".env"),
  };
}

export function homeEnvPath(): string {
  return path.join(openbotHome(), ".env");
}

/** Upsert keys in ~/.openbot/.env. Empty values are skipped so we never blank a key by accident. */
export function upsertHomeEnv(updates: Record<string, string>): string {
  const dest = homeEnvPath();
  ensureDir(openbotHome());
  const lines = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8").split(/\r?\n/) : [];
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (!Object.hasOwn(updates, key) || !trimValue(updates[key])) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!trimValue(value) || seen.has(key)) continue;
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${value}`);
  }
  const body = (next.join("\n").replace(/\n*$/, "") + "\n").replace(/^\n+/, "");
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, body || "\n", { mode: 0o600 });
  fs.renameSync(tmp, dest);
  fs.chmodSync(dest, 0o600);
  return dest;
}

export function nextStepForConnect(state: {
  hasHost: boolean;
  identityFile?: string;
  identityMissing?: boolean;
  sshOk: boolean;
  ohOk: boolean;
  hasSessionKey: boolean;
  sshError?: string;
}): { ready: boolean; nextStep: string } {
  const hostConfirmed = !state.hasHost || state.sshOk;
  if (state.ohOk && state.hasSessionKey && hostConfirmed) {
    return { ready: true, nextStep: "Ready. Messages go to OpenHands on your machine." };
  }
  if (state.ohOk && !state.hasSessionKey && hostConfirmed) {
    return {
      ready: false,
      nextStep:
        "OpenHands is reachable. Set OH_SESSION_API_KEY in Settings or ~/.openbot/.env (header X-Session-API-Key). Do not put it in git.",
    };
  }
  if (!state.hasHost) {
    return {
      ready: false,
      nextStep:
        "Open Settings and set host, user, port, and a local private-key path. The key file stays on this laptop; OpenBot only stores the path under ~/.openbot.",
    };
  }
  if (state.identityMissing) {
    return {
      ready: false,
      nextStep: `Key file not found: ${state.identityFile}. Point Settings at an existing local path such as ~/.ssh/id_ed25519.`,
    };
  }
  if (!state.sshOk) {
    const detail = state.sshError ? ` (${state.sshError})` : "";
    return {
      ready: false,
      nextStep: `SSH did not connect${detail}. Check host, user, port, and that the identity file is authorized. This client uses BatchMode — it will not prompt for a password.`,
    };
  }
  return {
    ready: false,
    nextStep:
      "SSH works, but OpenHands Agent Server is not answering on the host (127.0.0.1:8000). Chat cannot work yet. This repo does not install OpenHands — on that machine follow docs/openbot-mvp/06-ops/openhands-agent-server-trial.md, then `systemctl enable --now openhands-agent-server`. Put the host session key in ~/.openbot/.env as OH_SESSION_API_KEY. `npx openbot bind` is only the old worker and is optional for chat.",
  };
}
