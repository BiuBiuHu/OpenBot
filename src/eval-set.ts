import fs from "node:fs";
import path from "node:path";
import { voiceChatReply, type ChatOutcome } from "./chat-voice.js";
import { ensureDir, openbotHome, repoRoot } from "./paths.js";

export interface EvalRemoteFixture {
  status: ChatOutcome | "finished" | "error" | "succeeded";
  conversationId: string;
  rawReply: string;
}

export interface EvalExpect {
  remoteOutcome: "succeeded" | "failed" | "timeout";
  shownMustNotMatch?: string[];
  shownMustMatch?: string[];
  maxSentences?: number;
  maxChars?: number;
  shownEquals?: string;
}

export interface EvalCase {
  id: string;
  title: string;
  userMessage: string;
  remote: EvalRemoteFixture;
  expect: EvalExpect;
}

export interface EvalCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface EvalRunRecord {
  caseId: string;
  at: string;
  userMessage: string;
  shown: string;
  remote: {
    ok: boolean;
    status: string;
    conversationId: string;
  };
  pass: boolean;
  checks: EvalCheck[];
}

export interface LiveEvalRecord {
  at: string;
  userMessage: string;
  shown: string;
  remote: {
    ok: boolean;
    status: string;
    conversationId: string;
  };
}

const SECRET_MARK = /BEGIN [A-Z0-9 ]*PRIVATE KEY|\b(?:\d{1,3}\.){3}\d{1,3}\b|OH_SESSION_API_KEY|OPENAI_API_KEY/i;

export function evalSuiteDir(): string {
  return path.join(repoRoot(), "evals", "chat-layer");
}

export function loadEvalCases(dir = path.join(evalSuiteDir(), "cases")): EvalCase[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as EvalCase);
}

export function redactEvalText(value: string): string {
  return String(value || "")
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[key]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[host]");
}

export function assertNoSecrets(value: string): void {
  if (SECRET_MARK.test(value) && /BEGIN |SESSION_API_KEY|OPENAI_API_KEY/.test(value)) {
    throw new Error("eval record must not contain secrets");
  }
}

function mapFixtureOutcome(status: EvalRemoteFixture["status"]): ChatOutcome {
  if (status === "finished" || status === "succeeded") return "succeeded";
  if (status === "error") return "failed";
  return status;
}

export function shownForCase(c: EvalCase): string {
  return voiceChatReply({
    userMessage: c.userMessage,
    remoteText: c.remote.rawReply,
    outcome: mapFixtureOutcome(c.remote.status),
  }).text;
}

function countSentences(text: string): number {
  const stripped = text.replace(/\[[^\]]*\]\([^)]+\)/g, "LINK").replace(/https?:\/\/\S+/g, "LINK");
  return stripped.split(/[。！？!?]+|(?<=[A-Za-z])\.(?=\s|$)/).map((s) => s.trim()).filter(Boolean).length;
}

export function scoreEvalCase(c: EvalCase, shown: string, remoteOk: boolean): EvalCheck[] {
  const checks: EvalCheck[] = [];
  const expectOk = c.expect.remoteOutcome === "succeeded";
  checks.push({
    name: "remote-outcome",
    pass: expectOk ? remoteOk : !remoteOk,
    detail: `remoteOk=${remoteOk} expect=${c.expect.remoteOutcome}`,
  });
  if (c.expect.shownEquals !== undefined) {
    checks.push({
      name: "shown-equals",
      pass: shown === c.expect.shownEquals,
      detail: shown,
    });
  }
  for (const pat of c.expect.shownMustNotMatch || []) {
    const re = new RegExp(pat, "i");
    checks.push({
      name: `must-not:${pat}`,
      pass: !re.test(shown),
      detail: shown.slice(0, 160),
    });
  }
  for (const pat of c.expect.shownMustMatch || []) {
    const re = new RegExp(pat, "i");
    checks.push({
      name: `must:${pat}`,
      pass: re.test(shown),
      detail: shown.slice(0, 160),
    });
  }
  if (c.expect.maxSentences) {
    const n = countSentences(shown);
    checks.push({
      name: "max-sentences",
      pass: n <= c.expect.maxSentences,
      detail: `${n}`,
    });
  }
  if (c.expect.maxChars) {
    checks.push({
      name: "max-chars",
      pass: shown.length <= c.expect.maxChars,
      detail: `${shown.length}`,
    });
  }
  checks.push({
    name: "no-secrets",
    pass: !/BEGIN [A-Z0-9 ]*PRIVATE KEY|OH_SESSION_API_KEY/.test(shown),
  });
  return checks;
}

export function runEvalCase(c: EvalCase): EvalRunRecord {
  const shown = shownForCase(c);
  const outcome = mapFixtureOutcome(c.remote.status);
  const remoteOk = outcome === "succeeded";
  const checks = scoreEvalCase(c, shown, remoteOk);
  return {
    caseId: c.id,
    at: new Date().toISOString(),
    userMessage: redactEvalText(c.userMessage),
    shown: redactEvalText(shown),
    remote: {
      ok: remoteOk,
      status: outcome,
      conversationId: c.remote.conversationId,
    },
    pass: checks.every((x) => x.pass),
    checks,
  };
}

export function runEvalSuite(cases = loadEvalCases()): EvalRunRecord[] {
  return cases.map(runEvalCase);
}

export function evalRunsDir(): string {
  return path.join(openbotHome(), "evals");
}

export function writeEvalSuiteRun(records: EvalRunRecord[]): string {
  const dir = evalRunsDir();
  ensureDir(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `chat-layer-${stamp}.json`);
  const body = JSON.stringify(
    {
      suite: "chat-layer",
      at: new Date().toISOString(),
      pass: records.every((r) => r.pass),
      records,
    },
    null,
    2,
  );
  assertNoSecrets(body);
  fs.writeFileSync(file, `${body}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

export function appendLiveEvalRun(record: LiveEvalRecord): string {
  const dir = evalRunsDir();
  ensureDir(dir);
  const file = path.join(dir, "live.jsonl");
  const line = JSON.stringify({
    at: record.at,
    userMessage: redactEvalText(record.userMessage),
    shown: redactEvalText(record.shown),
    remote: {
      ok: record.remote.ok,
      status: String(record.remote.status || ""),
      conversationId: String(record.remote.conversationId || ""),
    },
  });
  assertNoSecrets(line);
  fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  return file;
}
