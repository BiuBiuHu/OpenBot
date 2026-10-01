import type { AgentEvent } from "./types.js";

export interface NormalizedOhEvent {
  id: string;
  kind: string;
  source: string;
  text: string;
  raw: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectContentParts(content: unknown, out: string[]): void {
  if (typeof content === "string") {
    if (content.trim()) out.push(content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (typeof part === "string") {
      if (part.trim()) out.push(part);
    } else if (isRecord(part) && typeof part.text === "string" && part.text.trim()) {
      out.push(part.text);
    }
  }
}

/** Final-answer text. 1.49.2 MessageEvent stores it on `llm_message.content`. */
export function answerTextsFromEvent(ev: unknown): string[] {
  if (!isRecord(ev)) return typeof ev === "string" && ev.trim() ? [ev] : [];
  const out: string[] = [];
  const llmMessage = isRecord(ev.llm_message) ? ev.llm_message : undefined;
  const message = isRecord(ev.message) ? ev.message : undefined;
  collectContentParts(ev.content, out);
  collectContentParts(message?.content, out);
  collectContentParts(llmMessage?.content, out);
  if (typeof ev.text === "string" && ev.text.trim()) out.push(ev.text);
  return out;
}

/** Internal monologue (ActionEvent.thought / reasoning_content). Not the reply. */
export function monologueTextsFromEvent(ev: unknown): string[] {
  if (!isRecord(ev)) return [];
  const out: string[] = [];
  const llmMessage = isRecord(ev.llm_message) ? ev.llm_message : undefined;
  collectContentParts(ev.thought, out);
  collectContentParts(ev.extended_content, out);
  if (typeof llmMessage?.reasoning_content === "string" && llmMessage.reasoning_content.trim()) {
    out.push(llmMessage.reasoning_content);
  }
  if (typeof ev.reasoning_content === "string" && ev.reasoning_content.trim()) {
    out.push(ev.reasoning_content);
  }
  return out;
}

/**
 * Conversational text on an OH event (answer + monologue).
 * Prefer `answerTextsFromEvent` for what the chat bubble should show.
 */
export function messageTextsFromEvent(ev: unknown): string[] {
  return [...answerTextsFromEvent(ev), ...monologueTextsFromEvent(ev)];
}

export function textsFromEvent(ev: unknown): string[] {
  if (!isRecord(ev)) return typeof ev === "string" && ev.trim() ? [ev] : [];
  const out = messageTextsFromEvent(ev);
  const action = isRecord(ev.action) ? ev.action : undefined;
  const observation = isRecord(ev.observation) ? ev.observation : undefined;
  collectContentParts(ev.body, out);
  collectContentParts(observation?.content, out);
  collectContentParts(action?.content, out);
  if (typeof ev.error === "string") out.push(ev.error);
  if (typeof ev.error_message === "string") out.push(ev.error_message);
  if (typeof action?.command === "string") out.push(action.command);
  if (typeof observation?.command === "string") out.push(observation.command);
  return out;
}

export function eventKey(ev: unknown, index: number): string {
  if (!isRecord(ev)) return `i:${index}`;
  const id = ev.id ?? ev.event_id ?? ev.eventId;
  if (id != null && String(id)) return String(id);
  const kind = String(ev.kind || ev.type || ev.event_type || "");
  const text = textsFromEvent(ev).join("|").slice(0, 120);
  return `i:${index}:${kind}:${text}`;
}

export function normalizeOhEvent(raw: unknown, index: number): NormalizedOhEvent {
  const rec = isRecord(raw) ? raw : {};
  const source = String(rec.source || rec.role || rec.sender || "");
  return {
    id: eventKey(raw, index),
    kind: String(rec.kind || rec.type || rec.event_type || ""),
    source,
    text: textsFromEvent(raw).map((t) => t.trim()).filter(Boolean).join("\n"),
    raw: rec,
  };
}

export function unseenOhEvents(items: unknown[], seen: Set<string>): NormalizedOhEvent[] {
  const out: NormalizedOhEvent[] = [];
  items.forEach((item, index) => {
    const ev = normalizeOhEvent(item, index);
    if (seen.has(ev.id)) return;
    seen.add(ev.id);
    out.push(ev);
  });
  return out;
}

function isStateKind(kind: string): boolean {
  return kind.includes("conversationstateupdate") || kind.includes("stateupdate");
}

/**
 * Map one OpenHands event onto the same-thread AgentEvent vocabulary.
 * User-sourced messages are skipped so the local bubble is not duplicated.
 */
export function agentEventsFromOh(ev: NormalizedOhEvent): AgentEvent[] {
  const kind = ev.kind.toLowerCase();
  const source = ev.source.toLowerCase();
  if (source === "user" || source === "human") return [];
  if (kind.includes("systemprompt") || kind.includes("condensation")) return [];

  const action = isRecord(ev.raw.action) ? ev.raw.action : undefined;
  const observation = isRecord(ev.raw.observation) ? ev.raw.observation : undefined;
  const errorText =
    ev.text ||
    (typeof ev.raw.error === "string" && ev.raw.error) ||
    (typeof ev.raw.error_message === "string" && ev.raw.error_message) ||
    "";

  if (kind.includes("error") || ev.raw.error || ev.raw.error_message) {
    return [{ type: "error", message: errorText || "remote error" }];
  }
  if (isStateKind(kind) || (kind.includes("status") && !kind.includes("message"))) {
    return [];
  }
  if (kind.includes("action") || action) {
    const mapped: AgentEvent[] = [];
    const thought = monologueTextsFromEvent(ev.raw).map((t) => t.trim()).filter(Boolean).join("\n");
    if (thought) mapped.push({ type: "thought", text: thought });
    const name = String(action?.kind || action?.name || action?.tool || ev.kind || "action");
    const args = action ? { ...action } : { text: ev.text };
    mapped.push({ type: "tool_start", name, args });
    return mapped;
  }
  if (kind.includes("observation") || observation) {
    const name = String(observation?.kind || observation?.name || ev.kind || "observation");
    return [{ type: "tool_result", name, result: ev.text || "(empty)" }];
  }
  const answer = answerTextsFromEvent(ev.raw).map((t) => t.trim()).filter(Boolean).join("\n");
  if (answer) {
    return [{ type: "token", text: answer }];
  }
  const monologue = monologueTextsFromEvent(ev.raw).map((t) => t.trim()).filter(Boolean).join("\n");
  if (monologue) {
    return [{ type: "thought", text: monologue }];
  }
  return [];
}

export function emitUnseenOhEvents(
  items: unknown[],
  seen: Set<string>,
  emit: (event: AgentEvent) => void,
): { mapped: number; content: number } {
  let mapped = 0;
  let content = 0;
  for (const ev of unseenOhEvents(items, seen)) {
    for (const next of agentEventsFromOh(ev)) {
      emit(next);
      mapped += 1;
      if (next.type === "thought" || next.type === "token" || next.type === "tool_result") {
        content += 1;
      }
    }
  }
  return { mapped, content };
}

/** Final-answer texts the chat UI would show (`token`), not monologue. */
export function clientVisibleReplyTexts(items: unknown[]): string[] {
  const out: string[] = [];
  for (const ev of unseenOhEvents(items, new Set())) {
    for (const mapped of agentEventsFromOh(ev)) {
      if (mapped.type === "token") out.push(mapped.text);
    }
  }
  return out;
}

/** Last agent MessageEvent answer — used when a conversation succeeded but nothing was shown. */
export function agentReplyText(items: unknown[]): string {
  const replies: string[] = [];
  for (const item of items) {
    const ev = normalizeOhEvent(item, 0);
    const kind = ev.kind.toLowerCase();
    const source = ev.source.toLowerCase();
    if (source === "user" || source === "human") continue;
    if (isStateKind(kind) || kind.includes("systemprompt") || kind.includes("condensation")) continue;
    if (kind.includes("action") || kind.includes("observation") || kind.includes("error")) continue;
    const text = answerTextsFromEvent(item).map((t) => t.trim()).filter(Boolean).join("\n");
    if (text) replies.push(text);
  }
  return replies.join("\n").trim();
}
