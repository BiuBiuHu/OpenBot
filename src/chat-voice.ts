/** Chat-layer voice: short, human replies. Remote dumps stay off the transcript. */

import type { SearchHit } from "./web-search.js";

export type ChatOutcome = "succeeded" | "failed" | "timeout" | "cancelled" | "running";

export interface VoiceInput {
  userMessage: string;
  remoteText?: string;
  outcome: ChatOutcome;
}

export interface VoiceReply {
  text: string;
  kind: "ok" | "fail";
}

const OPENHANDS_INTRO =
  /我是\s*OpenHands|I['’]?m OpenHands|I am OpenHands|可以操作计算机|AI\s*智能体|AI agent|workspace\/project|docs\.openhands\.dev|在终端里运行\s*shell/i;

const WHO_ARE_YOU = /你是谁|你谁啊|你叫什么|who are you|what are you/i;

const LOOKUP_ASK = /是什么|什么是|介绍一下|what(?:['’]s| is| are)\b|who is\b/i;

const COMPUTER_TASK =
  /uname|workspace|工作区|文件|目录|终端|\bshell\b|\bls\b|\bcat\b|mkdir|chmod|写一份|写一个|帮我(改|写|跑|修|部署|分析)|在(电脑|主机)上|运行命令|summarize uname/i;

const OTHER_PRODUCT = /grok\s*bot|grokbot|openclaw|chatgpt|claude\b|devin\b|cursor\b/i;

const DUMP_MARK =
  /排查过程|conversation\s+timed out|execution_status|\/opt\/|grep\s+-r|workspace\/project|succeeded\s+[0-9a-f-]{8}/i;

export function looksLikeOpenHandsIntro(text: string): boolean {
  const t = String(text || "");
  if (!OPENHANDS_INTRO.test(t)) return false;
  return /OpenHands/i.test(t) || /workspace\/project/.test(t) || /docs\.openhands/.test(t);
}

export function isWhoAreYou(message: string): boolean {
  return WHO_ARE_YOU.test(String(message || "").trim());
}

export function isComputerTask(message: string): boolean {
  return COMPUTER_TASK.test(String(message || ""));
}

/** Unknown-fact questions the chat layer should look up instead of asking OpenHands. */
export function needsLookup(message: string): boolean {
  const t = String(message || "").trim();
  if (!t) return false;
  if (isWhoAreYou(t)) return false;
  if (isComputerTask(t)) return false;
  return LOOKUP_ASK.test(t);
}

export function lookupQuery(message: string): string {
  let q = String(message || "").trim();
  q = q.replace(/^[请帮我,，\s]*介绍一下\s*/i, "");
  q = q.replace(/^(?:what(?:['’]s| is| are)|who is)\s+/i, "");
  q = q.replace(/^什么是\s*/i, "");
  q = q.replace(/\s*是什么[？?！!。.\s]*$/i, "");
  q = q.replace(/[？?！!。.\s]+$/g, "").trim();
  return q || String(message || "").trim();
}

export function mentionsOtherProduct(message: string): boolean {
  return OTHER_PRODUCT.test(String(message || ""));
}

export function looksLikeTechnicalDump(text: string): boolean {
  const t = String(text || "");
  if (DUMP_MARK.test(t)) return true;
  if (t.length > 480) return true;
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > 8) return true;
  return false;
}

export function sentenceCount(text: string): number {
  const stripped = String(text || "")
    .replace(/\[[^\]]*\]\([^)]+\)/g, "LINK")
    .replace(/https?:\/\/\S+/g, "LINK");
  return stripped
    .split(/[。！？!?]+|(?<=[A-Za-z])\.(?=\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export function preferChinese(message: string): boolean {
  return /[\u3400-\u9fff]/.test(String(message || ""));
}

/** Turn angle-bracket URLs into markdown links. Bare URLs are handled in the renderer. */
export function linkifyReply(text: string): string {
  return String(text || "").replace(/<((https?:\/\/)[^>\s]+)>/gi, (_, url: string) => markdownLink(url));
}

function markdownLink(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return `[${u.host}${path}](${url})`;
  } catch {
    return url;
  }
}

function timeoutLine(zh: boolean): string {
  return zh ? "这台电脑这轮没在时限里跑完。你再说一次就行。" : "The computer did not finish in time. Say it again if you want another try.";
}

function failLine(zh: boolean): string {
  return zh ? "这台电脑这轮没做成。你换一句再试。" : "The computer did not finish that. Try saying it another way.";
}

function whoLine(zh: boolean): string {
  return zh
    ? "我是 OpenBot。我在你自己的电脑上帮你做事，不是一份 OpenHands 说明书。"
    : "I'm OpenBot. I work on your own computer — not an OpenHands manual.";
}

function otherProductLine(zh: boolean, message: string): string {
  const name = (message.match(OTHER_PRODUCT) || ["that product"])[0];
  return zh
    ? `我先不背自我介绍。你问的是 ${name}，这边还没看到它的代码，所以我不会编一份架构。`
    : `I won't introduce myself. You asked about ${name}, and I don't see that code here, so I won't invent an architecture.`;
}

function dumpLine(zh: boolean): string {
  return zh
    ? "电脑上查过了。这边一句话：还没有能直接用的结论。"
    : "I looked on the computer. Short version: nothing I can hand you as a conclusion yet.";
}

export function voiceFromSearch(input: { userMessage: string; hits: SearchHit[] }): VoiceReply {
  const zh = preferChinese(input.userMessage);
  const hits = (input.hits || []).filter((h) => String(h.snippet || h.title || "").trim());
  if (!hits.length) {
    return {
      text: zh ? "网上没查成。" : "The lookup failed.",
      kind: "fail",
    };
  }
  const bits = hits
    .slice(0, 2)
    .map((h) => String(h.snippet || h.title).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const body = bits.join(zh ? "" : " ");
  const sentences = body
    .split(/(?<=[。！？])|(?<=[A-Za-z])\.(?=\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
  let text = sentences.join(zh ? "。" : ". ");
  if (text && !/[。！？.!?]$/.test(text)) text += zh ? "。" : ".";
  const lead = zh ? "网上查过了。" : "I looked it up. ";
  const shown = `${lead}${text}`.replace(/\s+/g, " ").trim();
  return { text: linkifyReply(shown), kind: "ok" };
}

export function voiceChatReply(input: VoiceInput): VoiceReply {
  const zh = preferChinese(input.userMessage);
  const remote = String(input.remoteText || "").trim();
  const outcome = input.outcome;

  if (outcome === "timeout" || outcome === "running") {
    return { text: timeoutLine(zh), kind: "fail" };
  }
  if (outcome === "failed" || outcome === "cancelled") {
    if (looksLikeOpenHandsIntro(remote) && isWhoAreYou(input.userMessage) && !mentionsOtherProduct(input.userMessage)) {
      return { text: whoLine(zh), kind: "ok" };
    }
    return { text: failLine(zh), kind: "fail" };
  }

  if (looksLikeOpenHandsIntro(remote)) {
    if (mentionsOtherProduct(input.userMessage)) {
      return { text: otherProductLine(zh, input.userMessage), kind: "ok" };
    }
    if (isWhoAreYou(input.userMessage)) {
      return { text: whoLine(zh), kind: "ok" };
    }
    return {
      text: zh
        ? "先不背说明书。你具体想让这台电脑做什么？"
        : "I'll skip the manual. What do you actually want this computer to do?",
      kind: "ok",
    };
  }

  if (!remote) {
    return { text: dumpLine(zh), kind: "ok" };
  }

  if (looksLikeTechnicalDump(remote) || sentenceCount(remote) > 4) {
    const conclusion = remote.match(/(?:结论[是：:]|short version[:：]|所以[，,]?)([^\n。]+[。]?)/);
    if (conclusion?.[1] && !looksLikeOpenHandsIntro(conclusion[1]) && !DUMP_MARK.test(conclusion[1])) {
      return { text: linkifyReply(conclusion[1].trim()), kind: "ok" };
    }
    return { text: dumpLine(zh), kind: "ok" };
  }

  return { text: linkifyReply(remote), kind: "ok" };
}

export function outcomeFromRemote(status?: string, timedOut = false): ChatOutcome {
  if (timedOut) return "timeout";
  const s = String(status || "").toLowerCase();
  if (s === "timeout") return "timeout";
  if (s === "failed" || s === "error" || s === "stuck") return "failed";
  if (s === "cancelled") return "cancelled";
  if (s === "running" || s === "idle" || s === "queued") return "running";
  return "succeeded";
}
