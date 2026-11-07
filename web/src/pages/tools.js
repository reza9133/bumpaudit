import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { api } from "../lib/chain.js";
import { explainError } from "../lib/errors.js";
import { keccakHex, sameHash } from "../lib/hash.js";
import { bumpChip, verdictBadge, severityBadge, flag, copyBtn } from "../components/badges.js";
import { notice } from "../components/states.js";
import { spinRing } from "../components/spinners.js";
import sample from "../assets/sample-changelog.md?raw";

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), input, hint ? h("span", { class: "field-hint" }, hint) : null);
}

async function run(btn, out, fn) {
  const label = [...btn.childNodes];
  btn.disabled = true;
  btn.replaceChildren(spinRing(14), "Working…");
  out.replaceChildren();
  try {
    out.replaceChildren(await fn());
  } catch (err) {
    const info = explainError(err);
    out.replaceChildren(notice(info.kind === "contract" ? "warn" : "error", info.message));
  } finally {
    btn.disabled = false;
    btn.replaceChildren(...label);
  }
}

function parserTool() {
  const text = h("textarea", { rows: 12, placeholder: "Paste the text of a changelog or release page here…", spellcheck: "false" });
  const ver = h("input", { type: "text", placeholder: "1.4.3", value: "1.4.3", maxlength: 64 });
  const out = h("div", { class: "tool-out" });
  const btn = h("button", { class: "btn btn-primary", type: "submit" }, icon("play", 15), "Run the parser");
  return h(
    "form",
    {
      class: "card form",
      onsubmit: (e) => {
        e.preventDefault();
        if (!text.value.trim()) return text.focus();
        run(btn, out, async () => {
          const r = await api.previewExtraction(text.value, ver.value.trim());
          if (!r.found) return notice("warn", h("strong", {}, "No section found. "), r.reason === "empty" ? "The heading exists but nothing under it could be read as an entry." : "The version does not appear as a heading-like line.", " Validators would revert this audit too. ", h("a", { href: "#/docs/release-pages" }, "See the release-page guide."));
          return h(
            "div",
            {},
            notice("ok", h("strong", {}, `Section for ${r.version} found. `), `Validators would read ${r.items.length} entr${r.items.length === 1 ? "y" : "ies"}.`),
            h("h4", {}, "Entries"),
            h("ol", { class: "entry-list", start: 0 }, r.items.map((it) => h("li", { value: it.index }, h("span", {}, it.text), it.explicit_breaking ? flag("injection", "explicit BREAKING marker") : null))),
            h("h4", {}, "Section text"),
            h("pre", { class: "notes-pre" }, r.block),
          );
        });
      },
    },
    h("h3", {}, icon("file", 18), "Parser preview"),
    h("p", { class: "muted" }, "A free dry run of the contract's parser. If you can see your entries here, validators will see them too. Use it before an audit, or when one reverts with “no heading”."),
    h("div", { class: "form-grid" }, field("Version to find", ver)),
    field("Page text", text),
    h("div", { class: "cta-row" }, btn, h("button", { class: "btn btn-ghost", type: "button", onclick: () => { text.value = sample; ver.value = "1.4.3"; } }, "Load the demo changelog")),
    out,
  );
}

function rulesTool() {
  const prev = h("input", { type: "text", value: "1.4.2", maxlength: 64 });
  const ver = h("input", { type: "text", value: "1.4.3", maxlength: 64 });
  const sev = h("select", {}, ["BREAKING", "FEATURE", "FIX"].map((s) => h("option", { value: s }, s.toLowerCase())));
  const out = h("div", { class: "tool-out" });
  const btn = h("button", { class: "btn btn-primary", type: "submit" }, icon("play", 15), "Preview verdict");
  return h(
    "form",
    {
      class: "card form",
      onsubmit: (e) => {
        e.preventDefault();
        run(btn, out, async () => {
          const r = await api.previewVerdict(prev.value.trim(), ver.value.trim(), sev.value);
          return h("div", { class: "result-grid" }, h("div", {}, h("span", { class: "muted small" }, "Declared"), bumpChip(r.declared_bump)), h("div", {}, h("span", { class: "muted small" }, "Honest bump needed"), bumpChip(r.required_bump)), h("div", {}, h("span", { class: "muted small" }, "Verdict"), verdictBadge(r.verdict, { big: true })), r.initial_development ? flag("pre", "0.y.z initial development") : null, r.prerelease ? flag("pre", "pre-release: exempt") : null);
        });
      },
    },
    h("h3", {}, icon("gauge", 18), "Verdict calculator"),
    h("p", { class: "muted" }, "What the rules would conclude for a version pair and a severity, without auditing anything."),
    h("div", { class: "form-grid" }, field("Previous stable version", prev), field("Version", ver)),
    field("Most severe change in the notes", sev),
    btn,
    out,
  );
}

function versionTool() {
  const v = h("input", { type: "text", value: "v2.0.0-rc.1+build.5", maxlength: 64 });
  const out = h("div", { class: "tool-out" });
  const btn = h("button", { class: "btn btn-primary", type: "submit" }, icon("play", 15), "Inspect");
  return h(
    "form",
    {
      class: "card form",
      onsubmit: (e) => {
        e.preventDefault();
        run(btn, out, async () => {
          const r = await api.describeVersion(v.value.trim());
          if (!r.valid) return notice("warn", "Not valid SemVer 2.0.0.");
          return h("dl", { class: "kv" }, h("dt", {}, "Normalized"), h("dd", {}, h("code", {}, r.normalized)), h("dt", {}, "Major / minor / patch"), h("dd", {}, `${r.major} / ${r.minor} / ${r.patch}`), h("dt", {}, "Pre-release"), h("dd", {}, r.prerelease || "none"), h("dt", {}, "Build metadata"), h("dd", {}, r.build || "none (ignored)"));
        });
      },
    },
    h("h3", {}, icon("tag", 18), "Version inspector"),
    h("p", { class: "muted" }, "Parses a version string the way the contract does. A leading v and build metadata are ignored."),
    field("Version", v),
    btn,
    out,
  );
}

function urlTool() {
  const u = h("input", { type: "url", value: "https://github.com/acme/widget/releases/", maxlength: 500 });
  const pre = h("input", { type: "checkbox", checked: true });
  const out = h("div", { class: "tool-out" });
  const btn = h("button", { class: "btn btn-primary", type: "submit" }, icon("play", 15), "Check URL");
  return h(
    "form",
    {
      class: "card form",
      onsubmit: (e) => {
        e.preventDefault();
        run(btn, out, async () => {
          const r = await api.checkUrl(u.value.trim(), pre.checked);
          return r.valid ? notice("ok", h("strong", {}, "Accepted. "), "Canonical form: ", h("code", { class: "break" }, r.canonical)) : notice("warn", h("strong", {}, "Rejected. "), pre.checked ? "A source prefix must be a public https URL on a domain name with a path." : "A notes URL must be a public https URL on a domain name.");
        });
      },
    },
    h("h3", {}, icon("link", 18), "URL checker"),
    h("p", { class: "muted" }, "The contract refuses IP literals, ports, userinfo, internal-looking suffixes, dot-segments and encoded dots."),
    field("URL", u),
    h("label", { class: "check" }, pre, "Check as a source prefix (needs a path)"),
    btn,
    out,
  );
}

function hashTool() {
  const text = h("textarea", { rows: 8, placeholder: "Paste the audited section text exactly as shown…", spellcheck: "false" });
  const hash = h("input", { type: "text", placeholder: "Stored block hash (hex)", spellcheck: "false" });
  const out = h("div", { class: "tool-out" });
  const btn = h("button", { class: "btn btn-primary", type: "submit" }, icon("shield", 15), "Compute & compare");
  return h(
    "form",
    {
      class: "card form",
      onsubmit: (e) => {
        e.preventDefault();
        run(btn, out, async () => {
          const local = await keccakHex(text.value);
          const cmp = hash.value.trim();
          return h("div", {}, h("div", { class: "hash-row" }, h("span", { class: "muted small" }, "keccak256"), h("code", { class: "break" }, local), copyBtn(local, "Copy hash")), cmp ? (sameHash(local, cmp) ? notice("ok", "Match: this text is what was audited.") : notice("warn", "No match: the text differs from what was audited, or the hash belongs to another audit.")) : null);
        });
      },
    },
    h("h3", {}, icon("hash", 18), "Hash verifier"),
    h("p", { class: "muted" }, "Every audit stores the exact release section and its Keccak-256 hash. Recompute it here to check a verdict offline, entirely in your browser."),
    field("Section text", text),
    field("Hash to compare (optional)", hash),
    btn,
    out,
  );
}

export async function render({ query }) {
  const TOOLS = [
    ["parser", "Parser preview", "file", parserTool],
    ["rules", "Verdict calculator", "gauge", rulesTool],
    ["version", "Version inspector", "tag", versionTool],
    ["url", "URL checker", "link", urlTool],
    ["hash", "Hash verifier", "hash", hashTool],
  ];
  let current = TOOLS.some((t) => t[0] === query.tool) ? query.tool : "parser";
  const body = h("div", {});
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const paint = () => {
    tabs.replaceChildren(...TOOLS.map(([id, label, ic]) => h("button", { class: "tab" + (current === id ? " active" : ""), role: "tab", "aria-selected": String(current === id), onclick: () => { current = id; paint(); } }, icon(ic, 16), label)));
    body.replaceChildren(TOOLS.find((t) => t[0] === current)[3]());
  };
  paint();
  const el = h(
    "div",
    { class: "container page narrow" },
    h("div", { class: "page-head" }, h("div", {}, h("span", { class: "eyebrow" }, "Tools"), h("h1", {}, "Free read-only tools"), h("p", { class: "muted" }, "These call the contract's view methods. No wallet, no transaction, no cost."))),
    tabs,
    body,
  );
  return { el };
}
