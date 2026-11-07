// A small, safe Markdown renderer for the docs. It builds DOM nodes (no innerHTML from content).
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { copyBtn } from "../components/badges.js";

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)]+\))/g;

export function inline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) out.push(h("code", {}, tok.slice(1, -1)));
    else if (m[2]) out.push(h("strong", {}, ...inline(tok.slice(2, -2))));
    else if (m[3]) out.push(h("em", {}, ...inline(tok.slice(1, -1))));
    else {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      const href = mm[2];
      if (href.startsWith("#/")) out.push(h("a", { href }, ...inline(mm[1])));
      else if (/^https:\/\//.test(href)) out.push(h("a", { href, target: "_blank", rel: "noopener noreferrer" }, ...inline(mm[1])));
      else out.push(mm[1]);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const slugify = (text) => text.toLowerCase().replace(/[`*]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** directives: map of name -> () => Node for lines like "::limits". */
export function renderMarkdown(src, directives = {}) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const root = h("div", { class: "prose" });
  const toc = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const dir = /^::([a-z]+)\s*$/.exec(line);
    if (dir) { const fn = directives[dir[1]]; if (fn) root.append(fn()); i++; continue; }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const code = buf.join("\n");
      root.append(h("div", { class: "codeblock" }, fence[1] ? h("span", { class: "code-lang" }, fence[1]) : null, copyBtn(code, "Copy code"), h("pre", { tabindex: "0" }, h("code", {}, code))));
      continue;
    }

    const head = /^(#{2,3})\s+(.*)$/.exec(line);
    if (head) {
      const level = head[1].length;
      const text = head[2].trim();
      const id = slugify(text);
      if (level === 2) toc.push({ id, text: text.replace(/[`*]/g, "") });
      root.append(h("h" + level, { id }, ...inline(text), h("a", { class: "anchor", href: "#", "aria-label": "Link to this section", "data-anchor": id, onclick: (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, icon("link", 14))));
      i++;
      continue;
    }

    if (/^\|/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      root.append(h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, header.map((c) => h("th", {}, ...inline(c))))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, ...inline(c)))))))));
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      let kind = "note";
      let text = buf.join(" ");
      const tag = /^\[!(NOTE|TIP|WARN|DANGER)\]\s*/.exec(text);
      if (tag) { kind = tag[1].toLowerCase(); text = text.slice(tag[0].length); }
      const ic = { note: "info", tip: "zap", warn: "alert", danger: "alert" }[kind];
      root.append(h("aside", { class: `callout callout-${kind}` }, icon(ic, 18), h("div", {}, ...inline(text))));
      continue;
    }

    if (/^(-|\d+\.)\s+/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^(-|\d+\.)\s+/.test(lines[i])) {
        let text = lines[i++].replace(/^(-|\d+\.)\s+/, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) text += " " + lines[i++].trim();
        items.push(h("li", {}, ...inline(text)));
      }
      root.append(h(ordered ? "ol" : "ul", {}, items));
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|```|\||>|-\s|\d+\.\s|::)/.test(lines[i])) buf.push(lines[i++]);
    root.append(h("p", {}, ...inline(buf.join(" "))));
  }
  return { el: root, toc };
}
