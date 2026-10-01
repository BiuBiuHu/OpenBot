/** Fetch a public document the person linked. HTTP only — not an OpenHands task. */

import { stripHtml } from "./web-search.js";

const UA = "Mozilla/5.0 (compatible; OpenBot/0.1; +https://github.com/BiuBiuHu/OpenBot)";

const DOC_ASK =
  /看看|读一下|读读|看一下|讲了什么|讲的是什么|这个讲的是什么|讲什么|说了什么|说的是什么|说什么|这个文档|这篇|这一章|这章|总结|summarize|what does|about this (doc|page|chapter)|this (doc|page|chapter)/i;

const GITHUB_BLOB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+\/blob\//i;

export interface PublicDocument {
  title: string;
  text: string;
  url: string;
}

export function extractPublicHttpUrl(message: string): string | undefined {
  const raw = String(message || "").match(/https?:\/\/[^\s<>"'）)】]+/i)?.[0];
  if (!raw) return undefined;
  const trimmed = raw.replace(/[。，、；：？！,.!?;:]+$/g, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** GitHub blob pages are HTML chrome. Read the raw file instead. */
export function readableDocumentUrl(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname === "github.com" || u.hostname === "www.github.com") {
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
      if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
    }
  } catch {
    /* keep original */
  }
  return href;
}

export function isDocumentReadAsk(message: string): boolean {
  const t = String(message || "").trim();
  if (!t) return false;
  const href = extractPublicHttpUrl(t);
  if (!href) return false;
  if (DOC_ASK.test(t) || /\.md(?:\b|$)/i.test(t)) return true;
  if (GITHUB_BLOB.test(t) && /什么|讲|说|总结|summarize|what|about/i.test(t)) return true;
  return false;
}

export function extractDocumentFacts(text: string): { title: string; sentences: string[] } {
  const raw = String(text || "").replace(/\r/g, "");
  let title = "";
  const heading = raw.match(/^#{1,3}\s+(.+)$/m);
  if (heading) title = heading[1].replace(/[#*`]+/g, "").trim();
  const clean = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const all = stripHtml(clean)
    .split(/[。！？]/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12 && s.length <= 96);
  const preferred = all.filter((s) => /这一章|本章|本文|这篇|本页|这一节|本节/.test(s));
  return { title, sentences: (preferred.length ? preferred : all).slice(0, 2) };
}

export async function readPublicDocument(
  url: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<PublicDocument | undefined> {
  const href = extractPublicHttpUrl(url) || String(url || "").trim();
  if (!href) return undefined;
  const dest = readableDocumentUrl(href);
  const fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    const res = await fetchFn(dest, {
      headers: {
        Accept: "text/markdown,text/plain,text/html;q=0.8,*/*;q=0.5",
        "User-Agent": UA,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(Math.max(1_000, opts.timeoutMs ?? 8_000)),
    });
    if (!res.ok) return undefined;
    const body = await res.text();
    if (!body.trim()) return undefined;
    const type = String(res.headers.get("content-type") || "");
    const text = type.includes("html") ? stripHtml(body) : body;
    const facts = extractDocumentFacts(text);
    return { title: facts.title, text, url: href };
  } catch {
    return undefined;
  }
}
