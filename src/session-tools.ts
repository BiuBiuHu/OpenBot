import { voiceFromDocument, voiceFromSearch, voiceNow } from "./chat-voice.js";
import { normalizeChatLanguage, prefersChineseSearch } from "./language.js";
import { browsePublicPage } from "./page-browse.js";
import { readPublicDocument, type PublicDocument } from "./page-read.js";
import { sendA2aSkill, type RemoteTaskDeps, type RemoteTaskResult } from "./remote-agent.js";
import type { OhConversation } from "./oh-client.js";
import { searchWeb, type SearchHit } from "./web-search.js";

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
  searchWeb?: (query: string) => Promise<SearchHit[]>;
  browsePublicPage?: (query: string) => Promise<SearchHit[]>;
  readPublicDocument?: (url: string) => Promise<PublicDocument | undefined>;
  conversationId: () => string | undefined;
  bag: SessionToolBag;
}

/** Capabilities on the Pi session. Nothing here runs until the model calls a tool. */
export interface SessionTools {
  clock(now?: Date): string;
  readPublicDocument(request: string): Promise<string>;
  webSearch(query: string): Promise<string>;
  /** Forwards one card skill. Does not run the skill in this process. */
  sendSkill(skillId: string, goal: string): Promise<RemoteTaskResult>;
}

export function createSessionTools(deps: SessionToolDeps): SessionTools {
  const language = () => normalizeChatLanguage(deps.language());
  return {
    clock(now) {
      return voiceNow({ language: language(), now: now ?? deps.now?.() ?? new Date() }).text;
    },
    async readPublicDocument(request) {
      const doc = await (deps.readPublicDocument
        ? deps.readPublicDocument(request)
        : readPublicDocument(request));
      return voiceFromDocument({ userMessage: request, document: doc, language: language() }).text;
    },
    async webSearch(query) {
      const lang = language();
      let hits = await (deps.searchWeb
        ? deps.searchWeb(query)
        : searchWeb(query, { preferChinese: prefersChineseSearch(lang) }));
      if (!hits.length) {
        const client = deps.client();
        hits = await (deps.browsePublicPage
          ? deps.browsePublicPage(query)
          : browsePublicPage(query, {
              client,
              oh: deps.oh(),
              timeoutMs: 25_000,
              pollMs: deps.pollMs,
            }).catch(() => [] as SearchHit[]));
      }
      return voiceFromSearch({ userMessage: query, hits, language: lang }).text;
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
