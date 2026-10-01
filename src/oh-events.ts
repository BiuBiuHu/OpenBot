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

export function textsFromEvent(ev: unknown): string[] {
  if (!isRecord(ev)) return typeof ev === "string" ? [ev] : [];
  const out: string[] = [];
  const message = isRecord(ev.message) ? ev.message : undefined;
  const action = isRecord(ev.action) ? ev.action : undefined;
  const observation = isRecord(ev.observation) ? ev.observation : undefined;
  const content = ev.content ?? message?.content ?? ev.body ?? observation?.content ?? action?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === "string") out.push(part);
      else if (isRecord(part) && typeof part.text === "string") out.push(part.text);
    }
  } else if (typeof content === "string") {
    out.push(content);
  }
  if (typeof ev.text === "string") out.push(ev.text);
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

/**
 * Map one OpenHands event onto the same-thread AgentEvent vocabulary.
 * User-sourced messages are skipped so the local bubble is not duplicated.
 */
export function agentEventsFromOh(ev: NormalizedOhEvent): AgentEvent[] {
  const kind = ev.kind.toLowerCase();
  const source = ev.source.toLowerCase();
  if (source === "user" || source === "human") return [];

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
  if (kind.includes("state") || kind.includes("status")) {
    const status = String(ev.raw.execution_status || ev.raw.status || ev.text || ev.kind);
    return [{ type: "status", text: `remote ${status}` }];
  }
  if (kind.includes("action") || action) {
    const name = String(action?.kind || action?.name || action?.tool || ev.kind || "action");
    const args = action ? { ...action } : { text: ev.text };
    return [{ type: "tool_start", name, args }];
  }
  if (kind.includes("observation") || observation) {
    const name = String(observation?.kind || observation?.name || ev.kind || "observation");
    return [{ type: "tool_result", name, result: ev.text || "(empty)" }];
  }
  if (ev.text) {
    return [{ type: "thought", text: ev.text }];
  }
  return [];
}

export function emitUnseenOhEvents(
  items: unknown[],
  seen: Set<string>,
  emit: (event: AgentEvent) => void,
): number {
  let n = 0;
  for (const ev of unseenOhEvents(items, seen)) {
    for (const mapped of agentEventsFromOh(ev)) {
      emit(mapped);
      n += 1;
    }
  }
  return n;
}
