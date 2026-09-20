import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenBotConfig } from "./types.js";
import { identityPath } from "./config.js";
import { expandHome, workerSourceDir } from "./paths.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function sshBaseArgs(config: OpenBotConfig, extras: string[] = []): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=20",
    "-p",
    String(config.host.port || 22),
    ...extras,
  ];
  const identity = identityPath(config);
  if (identity) {
    args.push("-o", "IdentitiesOnly=yes", "-i", identity);
  }
  return args;
}

export function sshTarget(config: OpenBotConfig): string {
  return `${config.host.user}@${config.host.hostname}`;
}

export function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts.input) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

export async function sshExec(config: OpenBotConfig, remoteCommand: string): Promise<RunResult> {
  const args = [...sshBaseArgs(config), sshTarget(config), remoteCommand];
  return runCommand("ssh", args);
}

export async function scpToRemote(
  config: OpenBotConfig,
  localPath: string,
  remotePath: string,
): Promise<RunResult> {
  const identity = identityPath(config);
  const scpArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=20",
    "-P",
    String(config.host.port || 22),
  ];
  if (identity) {
    scpArgs.push("-o", "IdentitiesOnly=yes", "-i", identity);
  }
  scpArgs.push(localPath, `${sshTarget(config)}:${remotePath}`);
  return runCommand("scp", scpArgs);
}

export async function probeSsh(config: OpenBotConfig): Promise<string> {
  const result = await sshExec(config, "uname -a && echo OPENBOT_SSH_OK");
  if (result.code !== 0 || !result.stdout.includes("OPENBOT_SSH_OK")) {
    throw new Error(
      `SSH failed (${result.code}): ${result.stderr || result.stdout || "no output"}`.trim(),
    );
  }
  return result.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.includes("OPENBOT_SSH_OK")) || result.stdout.trim();
}

export async function bootstrapWorker(config: OpenBotConfig): Promise<{
  persist: OpenBotConfig["worker"]["persist"];
  token: string;
  uname: string;
}> {
  const uname = await probeSsh(config);
  const remoteDir = expandHome(config.worker.remoteHome).replace(/^\/?home\/[^/]+/, "~");
  const staging = path.join(os.tmpdir(), `openbot-bootstrap-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const src = workerSourceDir();
  fs.copyFileSync(path.join(src, "worker.py"), path.join(staging, "worker.py"));
  fs.copyFileSync(path.join(src, "bootstrap.sh"), path.join(staging, "bootstrap.sh"));

  const mk = await sshExec(config, `mkdir -p ${shellQuote(remoteDir)}`);
  if (mk.code !== 0) {
    throw new Error(`Could not create ${remoteDir}: ${mk.stderr}`);
  }
  for (const file of ["worker.py", "bootstrap.sh"]) {
    const copied = await scpToRemote(config, path.join(staging, file), `${remoteDir}/${file}`);
    if (copied.code !== 0) {
      throw new Error(`scp ${file} failed: ${copied.stderr || copied.stdout}`);
    }
  }
  const workspace = config.worker.workspace;
  const remote = [
    `export OPENBOT_WORKER_HOME=${shellQuote(remoteDir)}`,
    `export OPENBOT_WORKER_PORT=${shellQuote(String(config.worker.remotePort))}`,
    `export OPENBOT_WORKSPACE=${shellQuote(workspace)}`,
    `bash ${shellQuote(remoteDir + "/bootstrap.sh")}`,
  ].join(" && ");
  const boot = await sshExec(config, remote);
  fs.rmSync(staging, { recursive: true, force: true });
  if (boot.code !== 0 || !boot.stdout.includes("OPENBOT_OK=1")) {
    throw new Error(
      `Remote bootstrap failed (${boot.code}):\n${boot.stdout}\n${boot.stderr}`.trim(),
    );
  }
  const persist = parsePersist(boot.stdout);
  const token = pickLine(boot.stdout, "OPENBOT_TOKEN=");
  if (!token) {
    throw new Error("Bootstrap succeeded but did not print OPENBOT_TOKEN");
  }
  return { persist, token, uname };
}

function parsePersist(stdout: string): OpenBotConfig["worker"]["persist"] {
  const value = pickLine(stdout, "OPENBOT_PERSIST=");
  if (value === "systemd-user" || value === "tmux" || value === "nohup") return value;
  return "unknown";
}

function pickLine(stdout: string, prefix: string): string {
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return "";
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export { sshBaseArgs };
