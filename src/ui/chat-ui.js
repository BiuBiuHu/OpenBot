/** Safe GFM-ish subset for assistant bubbles. User messages stay plain text. */

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function safeHref(href) {
  const raw = String(href || "")
    .trim()
    .replace(/&amp;/g, "&");
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw)) return raw;
  return "";
}

function inlineMd(s) {
  const codes = [];
  let out = escapeHtml(s).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `%%CODE${codes.length - 1}%%`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => {
    const safe = safeHref(href);
    if (!safe) return label;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/%%CODE(\d+)%%/g, (_, i) => codes[Number(i)]);
  return out;
}

function isListLine(line, ordered) {
  if (ordered === true) return /^\s*\d+[.)]\s+/.test(line);
  if (ordered === false) return /^\s*[-*+]\s+/.test(line);
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
}

function isTableRow(line) {
  return Boolean(line) && /\|/.test(line) && !/^\s*$/.test(line);
}

function isTableSep(line) {
  return /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
}

function splitCells(line) {
  let t = String(line).trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function renderTable(rows) {
  if (rows.length < 2) return `<p>${inlineMd(rows.join(" "))}</p>`;
  const head = splitCells(rows[0]);
  const body = rows.slice(2).map(splitCells);
  const th = head.map((c) => `<th>${inlineMd(c)}</th>`).join("");
  const tr = body
    .map((cells) => `<tr>${cells.map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function renderList(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  const lis = items
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""))
    .map((text) => `<li>${inlineMd(text)}</li>`)
    .join("");
  return `<${tag}>${lis}</${tag}>`;
}

function isBreakStart(lines, i) {
  const line = lines[i];
  if (!line || !line.trim()) return true;
  if (/^%%FENCE\d+%%$/.test(line.trim())) return true;
  if (/^#{1,6} /.test(line)) return true;
  if (isListLine(line)) return true;
  if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) return true;
  return false;
}

export function renderMarkdown(src) {
  const text = String(src ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return "";
  const fences = [];
  const prepared = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    fences.push({
      lang: String(lang || "").trim(),
      code: String(code || "").replace(/\n$/, ""),
    });
    return `\n\n%%FENCE${fences.length - 1}%%\n\n`;
  });
  const lines = prepared.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = line.trim().match(/^%%FENCE(\d+)%%$/);
    if (fence) {
      const f = fences[Number(fence[1])];
      const lang = f.lang ? ` class="language-${escapeHtml(f.lang)}"` : "";
      out.push(`<pre><code${lang}>${escapeHtml(f.code)}</code></pre>`);
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6}) (.*)$/);
    if (heading) {
      const n = heading[1].length;
      out.push(`<h${n}>${inlineMd(heading[2])}</h${n}>`);
      i += 1;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(rows));
      continue;
    }
    if (isListLine(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && isListLine(lines[i], ordered)) {
        items.push(lines[i]);
        i += 1;
      }
      out.push(renderList(items, ordered));
      continue;
    }
    const para = [];
    while (i < lines.length && !isBreakStart(lines, i)) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) out.push(`<p>${inlineMd(para.join(" "))}</p>`);
  }
  return out.join("");
}

/**
 * Enter sends only when the IME is not composing.
 * Shift+Enter is a newline (caller must not preventDefault).
 */
export function shouldSendOnEnter(event, extraComposing = false) {
  if (event.key !== "Enter") return false;
  if (event.shiftKey) return false;
  if (event.isComposing || event.keyCode === 229 || extraComposing) return false;
  return true;
}

/** Tracks IME composition plus the Enter that confirms it. */
export function createComposeGuard() {
  let composing = false;
  let lock = false;
  let unlockTimer = 0;
  return {
    onCompositionStart() {
      composing = true;
    },
    onCompositionEnd() {
      composing = false;
      lock = true;
      if (unlockTimer) clearTimeout(unlockTimer);
      const release = () => {
        unlockTimer = setTimeout(() => {
          lock = false;
          unlockTimer = 0;
        }, 0);
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(release);
      else release();
    },
    active() {
      return composing || lock;
    },
  };
}
