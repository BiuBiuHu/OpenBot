/** Last-resort public-page read via OpenHands browser. Chat layer voices the facts only. */

import { looksLikeOpenHandsIntro } from "./chat-voice.js";
import { agentReplyText } from "./oh-events.js";
import { isTerminalStatus, type OpenHandsClient, type OhConversation } from "./oh-client.js";
import type { OpenHandsConfig } from "./types.js";
import type { SearchHit } from "./web-search.js";

export interface BrowsePageDeps {
  client: OpenHandsClient;
  oh?: OpenHandsConfig;
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Ask OpenHands to open a public search page in its browser and return
 * short facts. Never used as the first lookup path.
 */
export async function browsePublicPage(query: string, deps: BrowsePageDeps): Promise<SearchHit[]> {
  const q = String(query || "").trim();
  if (!q) return [];
  const page = `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
  const goal = [
    `Open this public page in the browser: ${page}`,
    `Read the page. Reply with two short factual sentences about: ${q}.`,
    "Do not introduce yourself. Do not mention OpenHands, workspace, tools, or conversation ids.",
  ].join(" ");
  let last: OhConversation;
  try {
    last = await deps.client.createConversation(
      {
        goal,
        maxIterations: 8,
        tools: [{ name: "browser" }, { name: "terminal" }],
      },
      deps.oh,
    );
  } catch {
    return [];
  }
  const id = last.id;
  if (!id) return [];
  const timeoutMs = deps.timeoutMs ?? 25_000;
  const pollMs = deps.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let items: unknown[] = [];
  while (Date.now() < deadline) {
    last = await deps.client.getConversation(id);
    try {
      items = (await deps.client.searchEvents(id, { limit: 80 })).items;
    } catch {
      /* events optional */
    }
    if (isTerminalStatus(last.executionStatus)) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const raw = agentReplyText(items);
  if (!raw || looksLikeOpenHandsIntro(raw)) return [];
  const snippet = raw.replace(/\s+/g, " ").trim();
  if (snippet.length < 12) return [];
  return [{ title: q, snippet, url: page, source: "browser" }];
}
