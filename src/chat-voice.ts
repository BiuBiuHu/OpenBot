/** Chat-layer voice: short, human replies. Remote dumps stay off the transcript. */

import {
  applyChatLanguage,
  DEFAULT_CHAT_LANGUAGE,
  normalizeChatLanguage,
  type ChatLanguage,
} from "./language.js";
import { extractDocumentFacts, isDocumentReadAsk, type PublicDocument } from "./page-read.js";
import { decodeHtmlEntities, type SearchHit } from "./web-search.js";

export { isDocumentReadAsk } from "./page-read.js";

export type ChatOutcome = "succeeded" | "failed" | "timeout" | "cancelled" | "running";

export interface VoiceInput {
  userMessage: string;
  remoteText?: string;
  outcome: ChatOutcome;
  language?: ChatLanguage | string;
}

export interface VoiceReply {
  text: string;
  kind: "ok" | "fail";
}

const OPENHANDS_INTRO =
  /我是\s*OpenHands|I['’]?m OpenHands|I am OpenHands|可以操作计算机|AI\s*智能体|AI agent|workspace\/project|docs\.openhands\.dev|在终端里运行\s*shell/i;

const WHO_ARE_YOU = /你是谁|你谁啊|你叫什么|who are you|what are you/i;

const LOOKUP_ASK = /是什么|什么是|介绍一下|what(?:['’]s| is| are)\b|who is\b/i;

const CLOCK_ASK =
  /现在几点|几点了|几点钟|当前时间|现在的时间|今天的时间|系统时间|现在是几点|what time is it|what(?:['’]s| is) the time\b|current time\b|date and time/i;

const CODING_ASK =
  /改代码|写代码|修代码|改程式|写程式|修\s*bug|改个?(函数|接口)|帮我改代码|帮我写代码|你能帮我改|change (the )?code|fix (the )?code|edit (the )?code|write (some )?code|help me (change|fix|edit|write).{0,12}code/i;

const COMPUTER_TASK =
  /uname|workspace|工作区|文件|目录|终端|\bshell\b|\bls\b|\bcat\b|mkdir|chmod|写一份|写一个|帮我(改|写|跑|修|部署|分析)|在(电脑|主机)上|运行命令|summarize uname/i;

/** Wall clock the chat layer answers locally. Not a search. */
export const CHAT_TIME_ZONE = "Asia/Shanghai";

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

export function isClockAsk(message: string): boolean {
  const t = String(message || "").trim();
  if (!t) return false;
  if (CLOCK_ASK.test(t)) return true;
  if (/(今天|现在|当前).{0,8}(时间|几点)/.test(t) && !/会议|开会|发布|上线|截止/.test(t)) return true;
  if (/我是说.{0,16}(今天|现在).{0,8}时间/.test(t)) return true;
  return false;
}

export function isCodingAsk(message: string): boolean {
  return CODING_ASK.test(String(message || ""));
}

/** Capability / follow-up with no file or concrete edit. Answer locally. */
export function isVagueCodingAsk(message: string): boolean {
  const t = String(message || "").trim();
  if (!isCodingAsk(t)) return false;
  if (/\.[a-z0-9]{1,8}\b|[/\\][\w.-]+\.[a-z0-9]+|\bsrc\/|\btests\/|把\S{1,40}改成/i.test(t)) return false;
  return true;
}

/** Unknown-fact questions the chat layer should look up instead of asking OpenHands. */
export function needsLookup(message: string): boolean {
  const t = String(message || "").trim();
  if (!t) return false;
  if (isWhoAreYou(t)) return false;
  if (isClockAsk(t)) return false;
  if (isCodingAsk(t)) return false;
  if (isComputerTask(t)) return false;
  if (isDocumentReadAsk(t)) return false;
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

function codingReadyLine(zh: boolean): string {
  return zh
    ? "可以。说一下改哪个文件、想改成什么样。"
    : "Yes. Tell me which file and what you want changed.";
}

function skipManualLine(zh: boolean): string {
  return zh
    ? "先不背说明书。你具体想让这台电脑做什么？"
    : "I'll skip the manual. What do you actually want this computer to do?";
}

function pickPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value || "";
}

export function formatShanghaiClock(now = new Date(), language?: string): string {
  const lang = normalizeChatLanguage(language);
  const zh = lang !== "en";
  const parts = new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", {
    timeZone: CHAT_TIME_ZONE,
    year: "numeric",
    month: zh ? "numeric" : "long",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = pickPart(parts, "hour").padStart(2, "0");
  const minute = pickPart(parts, "minute").padStart(2, "0");
  if (!zh) {
    return `${pickPart(parts, "weekday")}, ${pickPart(parts, "month")} ${pickPart(parts, "day")}, ${pickPart(parts, "year")} ${hour}:${minute} in Shanghai`;
  }
  return `${pickPart(parts, "year")}年${pickPart(parts, "month")}月${pickPart(parts, "day")}日${pickPart(parts, "weekday")} ${hour}:${minute}（上海）`;
}

export function voiceNow(input: { language?: string; now?: Date } = {}): VoiceReply {
  const language = voiceLanguage(input);
  const zh = language !== "en";
  const clock = formatShanghaiClock(input.now ?? new Date(), language);
  const text = zh ? `现在是 ${clock}。` : `It's ${clock}.`;
  return { text: speak(text, language), kind: "ok" };
}

export function voiceCodingReady(input: { language?: string } = {}): VoiceReply {
  const language = voiceLanguage(input);
  return { text: speak(codingReadyLine(language !== "en"), language), kind: "ok" };
}

function voiceLanguage(input: { language?: string; userMessage?: string }): ChatLanguage {
  if (input.language !== undefined && input.language !== "") {
    return normalizeChatLanguage(input.language);
  }
  return DEFAULT_CHAT_LANGUAGE;
}

function speak(text: string, language: ChatLanguage): string {
  return applyChatLanguage(linkifyReply(text), language);
}

export function voiceFromDocument(
  input: { userMessage?: string; document?: PublicDocument; title?: string; text?: string; language?: string },
): VoiceReply {
  const language = voiceLanguage(input);
  const zh = language !== "en";
  const text = String(input.document?.text || input.text || "");
  const facts = extractDocumentFacts(text);
  const title = facts.title || input.document?.title || input.title || "";
  if (!facts.sentences.length && !title) {
    return { text: speak(zh ? "这个链接我没读成。" : "I could not read that page.", language), kind: "fail" };
  }
  if (zh) {
    const bits = [title ? `这一章是「${title}」` : "", ...facts.sentences].filter(Boolean);
    return { text: speak(`我看过了。${bits.join("。")}。`.replace(/。+/g, "。"), language), kind: "ok" };
  }
  const bits = [title, ...facts.sentences].filter(Boolean);
  return { text: speak(`I read it. ${bits.join(". ")}.`.replace(/\.\s*\./g, "."), language), kind: "ok" };
}

export function voiceFromSearch(input: { userMessage: string; hits: SearchHit[]; language?: string }): VoiceReply {
  const language = voiceLanguage(input);
  const zh = language !== "en";
  const hits = (input.hits || []).filter((h) => String(h.snippet || h.title || "").trim());
  if (!hits.length) {
    return {
      text: speak(zh ? "网上没查成。" : "The lookup failed.", language),
      kind: "fail",
    };
  }
  if (zh) {
    return { text: speak(shortChineseFromHits(lookupQuery(input.userMessage), hits), language), kind: "ok" };
  }
  const bits = hits
    .slice(0, 2)
    .map((h) => String(h.snippet || h.title).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const body = bits.join(" ");
  const sentences = body
    .split(/(?<=[。！？])|(?<=[A-Za-z])\.(?=\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
  let text = sentences.join(". ");
  if (text && !/[。！？.!?]$/.test(text)) text += ".";
  return { text: speak(`I looked it up. ${text}`.replace(/\s+/g, " ").trim(), language), kind: "ok" };
}

const SEARCH_JUNK =
  /小白入门|入门教程|一篇讲明白|本文依据|下载安装|创建第一个|官方文档|教程：|^\d{4}年\d{1,2}月\d{1,2}日/;

function lookLikeSearchTitle(text: string): boolean {
  const t = decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (SEARCH_JUNK.test(t)) return true;
  if (/&(?:ensp|emsp|nbsp|amp|#\d+|#x[0-9a-f]+);/i.test(t)) return true;
  return false;
}

function definitionSentence(text: string): string | undefined {
  const cleaned = decodeHtmlEntities(text)
    .replace(/^\d{4}年\d{1,2}月\d{1,2}日\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || lookLikeSearchTitle(cleaned)) return undefined;
  const sentence = cleaned.split(/[。！？]/).map((s) => s.trim()).filter(Boolean)[0];
  if (!sentence || lookLikeSearchTitle(sentence)) return undefined;
  if (sentence.length > 90) return undefined;
  if (!/是|为|指/.test(sentence) && !/机器人|智能体|聊天|对话/.test(sentence)) return undefined;
  return /[。！？]$/.test(sentence) ? sentence : `${sentence}。`;
}

function shortChineseFromHits(subject: string, hits: SearchHit[]): string {
  const ranked = [...hits].sort((a, b) => Number(b.source === "wikipedia") - Number(a.source === "wikipedia"));
  for (const hit of ranked) {
    const sentence = definitionSentence(hit.snippet) || definitionSentence(hit.title);
    if (sentence) return `网上查过了。${sentence}`;
  }
  const blob = decodeHtmlEntities(hits.map((h) => `${h.title} ${h.snippet}`).join(" "));
  const who = /SpaceXAI/i.test(blob) ? "SpaceXAI" : /xAI/i.test(blob) ? "xAI" : "";
  const bot = /chatbot|assistant|LLM|language model|生成式|聊天|对话|机器人/i.test(blob);
  const agent = /always-on agent|teammate|智能体|代理人/i.test(blob);
  const name = subject || "它";
  if (bot && who) {
    return agent
      ? `网上查过了。${name} 是 ${who} 做的对话机器人，公开资料也把它写成能替你干活的智能体。`
      : `网上查过了。${name} 是 ${who} 做的生成式对话机器人。`;
  }
  if (bot) return `网上查过了。${name} 是公开资料里的生成式对话机器人。`;
  if (who) return `网上查过了。${name} 和 ${who} 有关，是网上能查到的公开产品。`;
  return `网上查过了。${name} 是网上能查到的公开产品。`;
}

export function voiceChatReply(input: VoiceInput): VoiceReply {
  const language = voiceLanguage(input);
  const zh = language !== "en";
  const remote = String(input.remoteText || "").trim();
  const outcome = input.outcome;

  if (outcome === "timeout" || outcome === "running") {
    return { text: speak(timeoutLine(zh), language), kind: "fail" };
  }
  if (outcome === "failed" || outcome === "cancelled") {
    if (looksLikeOpenHandsIntro(remote) && isWhoAreYou(input.userMessage) && !mentionsOtherProduct(input.userMessage)) {
      return { text: speak(whoLine(zh), language), kind: "ok" };
    }
    return { text: speak(failLine(zh), language), kind: "fail" };
  }

  if (looksLikeOpenHandsIntro(remote)) {
    if (isClockAsk(input.userMessage)) {
      return voiceNow({ language, now: new Date() });
    }
    if (isCodingAsk(input.userMessage)) {
      return { text: speak(codingReadyLine(zh), language), kind: "ok" };
    }
    if (mentionsOtherProduct(input.userMessage)) {
      return { text: speak(otherProductLine(zh, input.userMessage), language), kind: "ok" };
    }
    if (isWhoAreYou(input.userMessage)) {
      return { text: speak(whoLine(zh), language), kind: "ok" };
    }
    return { text: speak(skipManualLine(zh), language), kind: "ok" };
  }

  if (!remote) {
    return { text: speak(dumpLine(zh), language), kind: "ok" };
  }

  if (looksLikeTechnicalDump(remote) || sentenceCount(remote) > 4) {
    const conclusion = remote.match(/(?:结论[是：:]|short version[:：]|所以[，,]?)([^\n。]+[。]?)/);
    if (conclusion?.[1] && !looksLikeOpenHandsIntro(conclusion[1]) && !DUMP_MARK.test(conclusion[1])) {
      return { text: speak(conclusion[1].trim(), language), kind: "ok" };
    }
    return { text: speak(dumpLine(zh), language), kind: "ok" };
  }

  return { text: speak(remote, language), kind: "ok" };
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
