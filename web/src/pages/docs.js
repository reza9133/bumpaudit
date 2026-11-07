import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { api } from "../lib/chain.js";
import { CONFIG, explorerAddress } from "../config.js";
import { renderMarkdown } from "../lib/markdown.js";
import { addrChip } from "../components/badges.js";
import { mochi } from "../components/brand.js";

const files = import.meta.glob("../docs/*.md", { query: "?raw", import: "default", eager: true });

function parseDoc(path, raw) {
  const slug = path.split("/").pop().replace(/^\d+-/, "").replace(/\.md$/, "");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const meta = {};
  let i = 0;
  while (i < lines.length && lines[i].trim() !== "") {
    const m = /^(\w+):\s*(.*)$/.exec(lines[i]);
    if (!m) break;
    meta[m[1]] = m[2];
    i++;
  }
  return { slug, order: path, title: meta.title || slug, group: meta.group || "Docs", summary: meta.summary || "", body: lines.slice(i).join("\n") };
}

export const DOCS = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, raw]) => parseDoc(p, raw));

const DEFAULT_LIMITS = [
  ["Max name chars", 80], ["Max URL chars", 500], ["Max entries per section", 60], ["Max entry chars", 300], ["Max section chars", 6000],
  ["Max evidence entries", 3], ["Max page size", 50], ["Max packages per registrant", 20], ["Max releases per package", 60],
  ["Max audits per address", 60], ["Max audits per release", 30], ["Min re-audit interval (seconds)", 300],
];
const LABELS = {
  max_name_chars: "Max name chars", max_url_chars: "Max URL chars", max_version_chars: "Max version chars", max_items: "Max entries per section", max_item_chars: "Max entry chars",
  max_block_chars: "Max section chars", max_block_lines: "Max section lines", max_evidence_items: "Max evidence entries", min_block_similarity_pct: "Min section similarity between validators (%)",
  max_preview_chars: "Max preview text chars", max_page_size: "Max page size", max_packages_per_registrant: "Max packages per registrant", max_releases_per_package: "Max releases per package",
  max_audits_per_address: "Max audits per address", max_audits_per_release: "Max audits per release", min_reaudit_interval_seconds: "Min re-audit interval (seconds)",
};

function table(head, rows) {
  return h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, c)))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));
}

const directives = {
  network: () =>
    h("div", { class: "card net-card" },
      h("h4", {}, icon("globe", 16), "Network and contract"),
      table(["Setting", "Value"], [
        ["Network name", CONFIG.chain.name],
        ["Chain ID", `${CONFIG.chain.id} (${CONFIG.chain.hex})`],
        ["RPC URL", h("code", {}, CONFIG.chain.rpc)],
        ["Currency symbol", CONFIG.chain.currency.symbol],
        ["Block explorer", h("a", { href: CONFIG.chain.explorer, target: "_blank", rel: "noopener noreferrer" }, CONFIG.chain.explorer)],
        ["BumpAudit contract", addrChip(CONFIG.contractAddress)],
      ]),
    ),
  limits: () => {
    const host = h("div", {}, table(["Limit", "Value"], DEFAULT_LIMITS.map(([k, v]) => [k, String(v)])), h("p", { class: "muted small" }, "Showing documented defaults while the live values load…"));
    api.limits().then((l) => {
      const rows = Object.keys(LABELS).filter((k) => k in l).map((k) => [LABELS[k], String(l[k])]);
      host.replaceChildren(table(["Limit", "Live value from get_limits()"], rows), h("p", { class: "muted small" }, `Contract version ${l.version}. Ecosystems: ${l.ecosystems.join(", ")}.`));
    }).catch(() => {});
    return host;
  },
};

export async function render({ params }) {
  const slug = params.slug || "introduction";
  const index = Math.max(0, DOCS.findIndex((d) => d.slug === slug));
  const doc = DOCS[index];
  const { el: body, toc } = renderMarkdown(doc.body, directives);

  const groups = [...new Set(DOCS.map((d) => d.group))];
  const nav = h("nav", { class: "docs-nav", "aria-label": "Documentation" }, groups.map((g) => h("div", { class: "dn-group" }, h("h4", {}, g), DOCS.filter((d) => d.group === g).map((d) => h("a", { href: `#/docs/${d.slug}`, class: d.slug === doc.slug ? "active" : "" }, d.title)))));
  const mobileNav = h("select", { class: "docs-select", "aria-label": "Choose a documentation page", onchange: (e) => (location.hash = `#/docs/${e.target.value}`) }, DOCS.map((d) => h("option", { value: d.slug, selected: d.slug === doc.slug }, d.title)));

  const tocEl = h("aside", { class: "docs-toc", "aria-label": "On this page" }, toc.length ? [h("h4", {}, "On this page"), toc.map((t) => h("a", { href: "#", "data-id": t.id, onclick: (e) => { e.preventDefault(); document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, t.text))] : null);

  const prev = DOCS[index - 1];
  const next = DOCS[index + 1];
  const pager = h("div", { class: "doc-pager" }, prev ? h("a", { href: `#/docs/${prev.slug}`, class: "card" }, h("span", { class: "muted small" }, "Previous"), h("strong", {}, prev.title)) : h("span", {}), next ? h("a", { href: `#/docs/${next.slug}`, class: "card next" }, h("span", { class: "muted small" }, "Next"), h("strong", {}, next.title)) : h("span", {}));

  const el = h(
    "div",
    { class: "container docs-layout" },
    h("div", { class: "docs-side" }, mobileNav, nav),
    h("article", { class: "docs-main" }, h("div", { class: "doc-head" }, h("div", {}, h("span", { class: "eyebrow" }, doc.group), h("h1", {}, doc.title), doc.summary ? h("p", { class: "lead" }, doc.summary) : null), h("div", { class: "doc-mochi" }, mochi({ mood: index % 3 === 0 ? "happy" : index % 3 === 1 ? "think" : "cheer", size: 84 }))), body, pager, h("p", { class: "muted small edit-note" }, icon("github", 14), "Found a mistake? ", h("a", { href: `${CONFIG.links.github}/issues`, target: "_blank", rel: "noopener noreferrer" }, "Open an issue on GitHub"), ".")),
    tocEl,
  );

  let spy = null;
  return {
    el,
    mounted() {
      const heads = [...body.querySelectorAll("h2[id]")];
      if (!heads.length) return;
      spy = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) tocEl.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.id === e.target.id));
        }
      }, { rootMargin: "-80px 0px -70% 0px" });
      heads.forEach((x) => spy.observe(x));
    },
    destroy: () => spy?.disconnect(),
  };
}
