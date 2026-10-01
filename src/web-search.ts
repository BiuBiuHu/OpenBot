/** Real web search for the chat layer. HTTP only — not a workspace grep. */

export interface SearchHit {
  title: string;
  snippet: string;
  url: string;
  source: "duckduckgo" | "wikipedia" | "bing" | "browser";
}

export interface SearchWebOptions {
  /** Injectable for tests. Production uses global fetch against public APIs. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Prefer Chinese Wikipedia / Bing when the person asked in Chinese. */
  preferChinese?: boolean;
}

const UA = "OpenBot/0.1 (local chat client; https://github.com/BiuBiuHu/OpenBot)";
const BROWSER_UA = "Mozilla/5.0 (compatible; OpenBot/0.1; +https://github.com/BiuBiuHu/OpenBot)";
const DDG = "https://api.duckduckgo.com/";
const WIKI_EN = "https://en.wikipedia.org";
const WIKI_ZH = "https://zh.wikipedia.org";
const BING = "https://www.bing.com/search";
const BING_CN = "https://cn.bing.com/search";

export async function searchWeb(query: string, opts: SearchWebOptions = {}): Promise<SearchHit[]> {
  const q = String(query || "").trim();
  if (!q) return [];
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const preferZh = Boolean(opts.preferChinese);
  const [ddg, wiki, bing] = await Promise.all([
    duckDuckGoHits(fetchFn, q, timeoutMs).catch(() => [] as SearchHit[]),
    wikipediaHits(fetchFn, q, timeoutMs, preferZh).catch(() => [] as SearchHit[]),
    bingHits(fetchFn, q, timeoutMs, preferZh).catch(() => [] as SearchHit[]),
  ]);
  let hits = dedupeHits([...wiki, ...bing, ...ddg]);
  if (!hits.length) {
    hits = dedupeHits(await wikiPageFallbacks(fetchFn, q, timeoutMs, preferZh).catch(() => [] as SearchHit[]));
  }
  return hits.slice(0, 6);
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

async function wikipediaHits(
  fetchFn: typeof fetch,
  q: string,
  timeoutMs: number,
  preferZh = false,
): Promise<SearchHit[]> {
  const [zh, en] = await Promise.all([
    wikipediaSearch(fetchFn, WIKI_ZH, q, timeoutMs).catch(() => [] as SearchHit[]),
    wikipediaSearch(fetchFn, WIKI_EN, q, timeoutMs).catch(() => [] as SearchHit[]),
  ]);
  return preferZh || /[\u3400-\u9fff]/.test(q) ? [...zh, ...en] : [...en, ...zh];
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

async function bingHits(
  fetchFn: typeof fetch,
  q: string,
  timeoutMs: number,
  preferZh = false,
): Promise<SearchHit[]> {
  const urls = preferZh
    ? [`${BING_CN}?q=${encodeURIComponent(q)}`, `${BING}?q=${encodeURIComponent(q)}&setlang=zh-CN`]
    : [`${BING}?q=${encodeURIComponent(q)}&setlang=en`, `${BING_CN}?q=${encodeURIComponent(q)}`];
  const pages = await Promise.all(urls.map((url) => getText(fetchFn, url, timeoutMs, preferZh).catch(() => "")));
  const hits: SearchHit[] = [];
  for (const html of pages) hits.push(...parseBingHtml(html));
  return hits;
}

async function wikiPageFallbacks(
  fetchFn: typeof fetch,
  q: string,
  timeoutMs: number,
  preferZh = false,
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const origins = preferZh || /[\u3400-\u9fff]/.test(q) ? [WIKI_ZH, WIKI_EN] : [WIKI_EN, WIKI_ZH];
  for (const origin of origins) {
    for (const slug of wikiSlugs(q)) {
      const summary = await wikipediaSummary(fetchFn, origin, slug.replace(/_/g, " "), timeoutMs).catch(() => undefined);
      if (summary?.extract) {
        hits.push({
          title: summary.title,
          snippet: summary.extract,
          url: summary.url,
          source: "wikipedia",
        });
        continue;
      }
      const html = await getText(fetchFn, `${origin}/wiki/${encodeURIComponent(slug)}`, timeoutMs, preferZh).catch(() => "");
      const page = parseWikipediaArticle(html, `${origin}/wiki/${slug}`);
      if (page) hits.push(page);
    }
  }
  return hits;
}

function wikiSlugs(q: string): string[] {
  const cleaned = q.replace(/[？?！!。.]/g, "").trim();
  const slugs = [cleaned.replace(/\s+/g, "_")];
  const first = cleaned.split(/\s+/)[0];
  if (first && first !== cleaned) slugs.push(first);
  if (/grok/i.test(cleaned)) slugs.push("Grok_(chatbot)", "Grok", "Grok_Bot");
  return [...new Set(slugs.filter(Boolean))].slice(0, 4);
}

export function parseWikipediaArticle(html: string, url = ""): SearchHit | undefined {
  const title = stripHtml((String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
  const paras = [...String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1] || ""))
    .filter((p) => p.length > 40 && !/^coordinates/i.test(p));
  if (!paras[0]) return undefined;
  return { title: title || paras[0].slice(0, 40), snippet: paras[0], url: safeHttpUrl(url), source: "wikipedia" };
}

export function parseBingHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const chunks = String(html || "").split(/<li class="b_algo"/i).slice(1);
  for (const raw of chunks.slice(0, 5)) {
    const block = raw.slice(0, 5_000);
    const title = stripHtml((block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || "");
    const href = (block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i) || [])[1] || "";
    const snippet = stripHtml(
      (block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
        block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ||
        [])[1] || "",
    );
    if (!title || !snippet) continue;
    hits.push({
      title,
      snippet: cleanBingSnippet(snippet),
      url: safeHttpUrl(href),
      source: "bing",
    });
  }
  return hits;
}

function cleanBingSnippet(value: string): string {
  return value
    .replace(/^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s*[·.\u00b7\u2022]+\s*/u, "")
    .replace(/^\d{4}年\d{1,2}月\d{1,2}日\s*[·.\u00b7\u2022]+\s*/u, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const text = await res.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function getText(fetchFn: typeof fetch, url: string, timeoutMs: number, preferZh = false): Promise<string> {
  const res = await fetchFn(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": preferZh ? "zh-CN,zh;q=0.9,en;q=0.4" : "en,zh;q=0.8",
      "User-Agent": BROWSER_UA,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
  });
  if (!res.ok) return "";
  return res.text();
}

export function stripHtml(value: string): string {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;|&#0183;/g, " ")
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
