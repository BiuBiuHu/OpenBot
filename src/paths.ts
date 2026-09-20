import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function openbotHome(): string {
  return expandHome(process.env.OPENBOT_HOME || path.join(os.homedir(), ".openbot"));
}

export function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  const base = path.basename(dir);
  if (base === "dist" || base === "src") {
    dir = path.dirname(dir);
  }
  return dir;
}

export function workerSourceDir(): string {
  return path.join(repoRoot(), "worker");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
