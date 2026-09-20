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

function pick(env: Record<string, string>, key: string, fallback = ""): string {
  return process.env[key] || env[key] || fallback;
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
      apiKey: partial.llm?.apiKey || pick(env, "OPENAI_API_KEY"),
    },
    controlPlane: {
      port: partial.controlPlane?.port || Number(pick(env, "OPENBOT_CONTROL_PORT", "3847")),
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
