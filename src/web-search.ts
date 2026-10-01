/** Real web search for the chat layer. HTTP only — not a workspace grep. */

export interface SearchHit {
  title: string;
  snippet: string;
  url: string;
  source: "duckduckgo" | "wikipedia";
}

export interface SearchWebOptions {
  /** Injectable for tests. Production uses global fetch against public APIs. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const UA = "OpenBot/0.1 (local chat client; https://github.com/BiuBiuHu/OpenBot)";
const DDG = "https://api.duckduckgo.com/";
const WIKI_EN = "https://en.wikipedia.org";
const WIKI_ZH = "https://zh.wikipedia.org";

export async function searchWeb(query: string, opts: SearchWebOptions = {}): Promise<SearchHit[]> {
  const q = String(query || "").trim();
  if (!q) return [];
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const [ddg, wiki] = await Promise.all([
    duckDuckGoHits(fetchFn, q, timeoutMs).catch(() => [] as SearchHit[]),
    wikipediaHits(fetchFn, q, timeoutMs).catch(() => [] as SearchHit[]),
  ]);
  return dedupeHits([...ddg, ...wiki]).slice(0, 5);
}

async function duckDuckGoHits(fetchFn: typeof fetch, q: string, timeoutMs: number): Promise<SearchHit[]> {
  const url = `${DDG}?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  const data = await getJson(fetchFn, url, timeoutMs);
  if (!data || typeof data !== "object") return [];
  const rec = data as Record<string, unknown>;
  const hits: SearchHit[] = [];
  const abstract = stripHtml(String(rec.AbstractText || rec.Answer || ""));
  const heading = stripHtml(String(rec.Heading || ""));
  const absUrl = String(rec.AbstractURL || rec.AnswerURL || "");
  if (abstract) {
    hits.push({
      title: heading || q,
      snippet: abstract,
      url: safeHttpUrl(absUrl),
      source: "duckduckgo",
    });
  }
  const related = Array.isArray(rec.RelatedTopics) ? rec.RelatedTopics : [];
  for (const item of related) {
    flattenRelated(item, hits);
    if (hits.length >= 4) break;
  }
  return hits;
}

function flattenRelated(item: unknown, hits: SearchHit[]): void {
  if (!item || typeof item !== "object") return;
  const rec = item as Record<string, unknown>;
  if (Array.isArray(rec.Topics)) {
    for (const nested of rec.Topics) flattenRelated(nested, hits);
    return;
  }
  const text = stripHtml(String(rec.Text || ""));
  if (!text) return;
  hits.push({
    title: text.split(" - ")[0] || text.slice(0, 40),
    snippet: text,
    url: safeHttpUrl(String(rec.FirstURL || "")),
    source: "duckduckgo",
  });
}

async function wikipediaHits(fetchFn: typeof fetch, q: string, timeoutMs: number): Promise<SearchHit[]> {
  const primary = /[\u3400-\u9fff]/.test(q) ? WIKI_ZH : WIKI_EN;
  const secondary = primary === WIKI_ZH ? WIKI_EN : WIKI_ZH;
  const first = await wikipediaSearch(fetchFn, primary, q, timeoutMs);
  if (first.length) return first;
  return wikipediaSearch(fetchFn, secondary, q, timeoutMs);
}

async function wikipediaSearch(
  fetchFn: typeof fetch,
  origin: string,
  q: string,
  timeoutMs: number,
): Promise<SearchHit[]> {
  const searchUrl =
    `${origin}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}` +
    "&format=json&srlimit=3&utf8=1";
  const data = await getJson(fetchFn, searchUrl, timeoutMs);
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
  const query = rec?.query && typeof rec.query === "object" ? (rec.query as Record<string, unknown>) : undefined;
  const rows = Array.isArray(query?.search) ? query.search : [];
  const hits: SearchHit[] = [];
  for (const row of rows.slice(0, 2)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const title = stripHtml(String(item.title || ""));
    if (!title) continue;
    const snippet = stripHtml(String(item.snippet || item.title || ""));
    const pageUrl = `${origin}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const summary = await wikipediaSummary(fetchFn, origin, title, timeoutMs).catch(() => undefined);
    hits.push({
      title: summary?.title || title,
      snippet: summary?.extract || snippet,
      url: summary?.url || pageUrl,
      source: "wikipedia",
    });
  }
  return hits;
}

async function wikipediaSummary(
  fetchFn: typeof fetch,
  origin: string,
  title: string,
  timeoutMs: number,
): Promise<{ title: string; extract: string; url: string } | undefined> {
  const url = `${origin}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const data = await getJson(fetchFn, url, timeoutMs);
  if (!data || typeof data !== "object") return undefined;
  const rec = data as Record<string, unknown>;
  const extract = stripHtml(String(rec.extract || rec.description || ""));
  if (!extract) return undefined;
  const urls = rec.content_urls && typeof rec.content_urls === "object" ? (rec.content_urls as Record<string, unknown>) : undefined;
  const desktop = urls?.desktop && typeof urls.desktop === "object" ? (urls.desktop as Record<string, unknown>) : undefined;
  return {
    title: stripHtml(String(rec.title || title)),
    extract,
    url: safeHttpUrl(String(desktop?.page || `${origin}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`)),
  };
}

async function getJson(fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetchFn(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
  });
  if (!res.ok) return undefined;
  return res.json();
}

export function stripHtml(value: string): string {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function safeHttpUrl(value: string): string {
  try {
    const u = new URL(value);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* ignore */
  }
  return "";
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const snippet = stripHtml(hit.snippet || "");
    if (!snippet) continue;
    const key = `${hit.title.toLowerCase()}|${snippet.slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...hit, title: stripHtml(hit.title), snippet, url: safeHttpUrl(hit.url) });
  }
  return out;
}
