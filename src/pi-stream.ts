import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEventStream } from "@earendil-works/pi-ai";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function assistantTextMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openbot",
    model: "openbot",
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** Push a finished assistant message after the caller has subscribed to the stream. */
export function emitAssistantMessage(stream: AssistantMessageEventStream, message: AssistantMessage): void {
  const text = message.content.find((part) => part.type === "text" && "text" in part);
  const body = text && text.type === "text" ? text.text : "";
  const pending: AssistantMessage = { ...message, content: [], stopReason: "pending" };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: pending });
    if (message.stopReason === "toolUse") {
      const call = message.content.find((part) => part.type === "toolCall");
      if (call && call.type === "toolCall") {
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
      }
      stream.push({ type: "done", reason: "toolUse", message });
      return;
    }
    stream.push({ type: "text_start", contentIndex: 0, partial: message });
    stream.push({ type: "text_delta", contentIndex: 0, delta: body, partial: message });
    stream.push({ type: "text_end", contentIndex: 0, content: body, partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });
}

export function textStream(text: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  emitAssistantMessage(stream, assistantTextMessage(text));
  return stream;
}

export function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("text" in part)) return "";
      return String((part as { text?: unknown }).text || "");
    })
    .join("");
}
