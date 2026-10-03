import { voiceNow } from "./chat-voice.js";
import { normalizeChatLanguage } from "./language.js";
import { sendA2aSkill, type RemoteTaskDeps, type RemoteTaskResult } from "./remote-agent.js";
import type { OhConversation } from "./oh-client.js";

export interface SessionToolBag {
  conversation?: OhConversation;
  remote?: RemoteTaskResult;
}

export interface SessionToolDeps {
  client: () => RemoteTaskDeps["client"];
  oh: () => RemoteTaskDeps["oh"];
  language: () => string | undefined;
  now?: () => Date;
  pollMs?: number;
  threadId?: string;
  conversationId: () => string | undefined;
  bag: SessionToolBag;
}

/** Capabilities on the Pi session. Nothing here runs until the model calls a tool. */
export interface SessionTools {
  clock(now?: Date): string;
  /** Forwards one card skill. Does not run the skill in this process. */
  sendSkill(skillId: string, goal: string): Promise<RemoteTaskResult>;
}

export function createSessionTools(deps: SessionToolDeps): SessionTools {
  const language = () => normalizeChatLanguage(deps.language());
  return {
    clock(now) {
      return voiceNow({ language: language(), now: now ?? deps.now?.() ?? new Date() }).text;
    },
    async sendSkill(skillId, goal) {
      const result = await sendA2aSkill(skillId, goal, {
        client: deps.client(),
        oh: deps.oh(),
        language: language(),
        pollMs: deps.pollMs,
        threadId: deps.threadId,
        conversationId: deps.conversationId(),
      });
      deps.bag.conversation = result.conversation;
      deps.bag.remote = result;
      return result;
    },
  };
}
