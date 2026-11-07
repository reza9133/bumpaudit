import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { api } from "../lib/chain.js";
import { pct, timeAgo } from "../lib/format.js";
import { motionReduced } from "../lib/theme.js";
import { bumpLogo, genlayerLogo, mochi } from "../components/brand.js";
import { gauge, ecoBadge, verdictBadge, verdictBar } from "../components/badges.js";
import { skeletonGrid } from "../components/spinners.js";
import { tilt } from "../components/tilt.js";
import { emptyState } from "../components/states.js";

const STEPS = [
  { n: "01", icon: "package", title: "Register", text: "Pin where a package's release notes may come from. The source prefix is part of its identity, so look-alikes can never overwrite a real record." },
  { n: "02", icon: "zap", title: "Audit a release", text: "Validators fetch the notes, find the version's section and classify each entry as breaking, feature or fix. The AI answers with entry numbers only." },
  { n: "03", icon: "refresh", title: "Re-check, forever", text: "Re-read the same pinned URL at any time. Quiet edits and softened notes are flagged on the release permanently." },
];

const VERDICTS = [
  { v: "COMPLIANT", line: "The bump matches what changed.", back: "Shipped exactly the honest bump: MAJOR for breaking changes, MINOR for features, PATCH for fixes." },
  { v: "UNDER_BUMPED", line: "The version number understates the change.", back: "A breaking change hid in a PATCH or MINOR release. This is the only verdict that lowers the integrity score." },
  { v: "OVER_BUMPED", line: "More cautious than needed. Harmless.", back: "A maintainer may always bump higher than required, so this counts as honest in the integrity score." },
  { v: "EXEMPT", line: "Pre-releases are allowed to be unstable.", back: "Versions like 2.0.0-rc.1 are audited and stored, but not scored. SemVer lets them change freely." },
];

const DEMO_ROWS = [
  { prev: "1.4.2", next: "1.4.3", bump: "PATCH", entry: "Removed the deprecated --legacy flag. Scripts that still pass it now fail.", verdict: "UNDER_BUMPED" },
  { prev: "1.4.3", next: "1.5.0", bump: "MINOR", entry: "Added streaming uploads for large files.", verdict: "COMPLIANT" },
  { prev: "1.5.0", next: "2.0.0", bump: "MAJOR", entry: "Removed the legacy connect() API. Use Client.open() instead.", verdict: "COMPLIANT" },
];

function demoCard() {
  const rows = DEMO_ROWS.map((r) =>
    h(
      "div",
      { class: "demo-row" },
      h("div", { class: "demo-top" }, h("code", {}, `${r.prev} → ${r.next}`), h("span", { class: `bump bump-${r.bump.toLowerCase()}` }, r.bump)),
      h("p", { class: "demo-entry" }, icon("file", 14), `“${r.entry}”`),
      h("div", { class: "demo-verdict" }, verdictBadge(r.verdict)),
    ),
  );
  return h("div", { class: "demo-card card glow-border" }, h("div", { class: "demo-head" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")), h("code", {}, "acme-widget · npm")), rows);
}

function flipCard(item) {
  const card = h(
    "div",
    { class: "flip", tabindex: "0", role: "button", "aria-pressed": "false", "aria-label": `${item.v}: ${item.line} Press to flip.` },
    h(
      "div",
      { class: "flip-inner" },
      h("div", { class: "flip-face flip-front" }, verdictBadge(item.v, { big: true }), h("p", {}, item.line), h("span", { class: "flip-hint" }, "Hover or tap for the rule")),
      h("div", { class: "flip-face flip-back" }, h("strong", {}, item.v.replace("_", " ").toLowerCase()), h("p", {}, item.back)),
    ),
  );
  const toggle = () => card.setAttribute("aria-pressed", String(card.classList.toggle("flipped")));
  card.addEventListener("click", toggle);
  card.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle()));
  return card;
}

function packageCard(p) {
  return tilt(
    h(
      "a",
      { class: "card pkg-card", href: `#/package/${p.id}` },
      h("div", { class: "pkg-top" }, h("div", {}, h("h3", {}, p.name), ecoBadge(p.ecosystem)), gauge(p.integrity_permille, { size: 62 })),
      verdictBar(p),
      h("div", { class: "pkg-meta muted small" }, `${p.releases} release${p.releases === 1 ? "" : "s"} · last audit ${timeAgo(p.last_audit_at)}`),
    ),
    { max: 7 },
  );
}

export async function render() {
  let scene = null;
  let consensus = null;
  let destroyed = false;
  let observer = null;

  const statsHost = h("div", { class: "hero-stats" });
  const heroScene = h("div", { class: "scene-host hero-scene" }, h("div", { class: "scene-fallback" }, bumpLogo(150)));
  const consensusScene = h("div", { class: "scene-host consensus-scene" }, h("div", { class: "scene-fallback" }, genlayerLogo(120)));
  const latestHost = h("div", {}, skeletonGrid(3));

  const el = h(
    "div",
    { class: "home" },
    h(
      "section",
      { class: "hero" },
      h("div", { class: "hero-bg", "aria-hidden": "true" }, h("i", { class: "orb o1" }), h("i", { class: "orb o2" }), h("i", { class: "grid-lines" })),
      h(
        "div",
        { class: "container hero-grid" },
        h(
          "div",
          { class: "hero-copy" },
          h("span", { class: "eyebrow" }, h("i", { class: "pulse-dot" }), "Live on GenLayer Studionet"),
          h("h1", {}, "Do version numbers ", h("span", { class: "grad" }, "tell the truth?")),
          h(
            "p",
            { class: "lead" },
            "A PATCH should only fix bugs. A MINOR should only add. Nothing enforces it. BumpAudit reads a release's notes, lets the GenLayer validator network judge every entry, and compares the verdict with the bump the maintainers actually shipped.",
          ),
          h(
            "div",
            { class: "cta-row" },
            h("a", { class: "btn btn-primary btn-lg btn-glow", href: "#/explorer" }, icon("layers", 18), "Explore audits"),
            h("a", { class: "btn btn-ghost btn-lg", href: "#/audit" }, icon("zap", 18), "Audit a release"),
            h("a", { class: "btn btn-link btn-lg", href: "#/docs/introduction" }, "Read the docs", icon("arrow", 16)),
          ),
          statsHost,
        ),
        h("div", { class: "hero-visual" }, heroScene, h("div", { class: "hero-mochi" }, mochi({ mood: "happy", size: 136 }))),
      ),
      h("div", { class: "container" }, demoCard()),
    ),

    h(
      "section",
      { class: "section" },
      h(
        "div",
        { class: "container" },
        h("div", { class: "section-head" }, h("span", { class: "eyebrow" }, "How it works"), h("h2", {}, "The AI proposes. Plain code disposes."), h("p", { class: "muted" }, "A model can only answer with entry numbers, so it can never write its own text, or text smuggled in by the page, into contract state.")),
        h(
          "div",
          { class: "card-grid cols-3" },
          STEPS.map((s) => tilt(h("article", { class: "card step-card" }, h("span", { class: "step-n" }, s.n), h("span", { class: "step-ico" }, icon(s.icon, 24)), h("h3", {}, s.title), h("p", {}, s.text)))),
        ),
      ),
    ),

    h(
      "section",
      { class: "section alt" },
      h(
        "div",
        { class: "container" },
        h("div", { class: "section-head" }, h("span", { class: "eyebrow" }, "Four verdicts"), h("h2", {}, "What a release can be"), h("p", { class: "muted" }, "The declared bump is arithmetic. The honest bump comes from the most severe entry in the notes.")),
        h("div", { class: "flip-grid" }, VERDICTS.map(flipCard)),
        h("p", { class: "center" }, h("a", { class: "btn btn-link", href: "#/docs/rules" }, "See the full rules table", icon("arrow", 16))),
      ),
    ),

    h(
      "section",
      { class: "section" },
      h(
        "div",
        { class: "container split" },
        h(
          "div",
          { class: "split-copy" },
          h("span", { class: "eyebrow" }, "Consensus"),
          h("h2", {}, "Every validator checks the evidence itself"),
          h("p", { class: "muted" }, "The leader proposes a section and a classification. Each validator re-fetches the page on its own, and only agrees when it sees the same entries, finds every quoted line verbatim on its own copy, and reaches the same severity independently."),
          h(
            "ul",
            { class: "check-list" },
            ["Quotes are always taken from the page, never written by a model", "A fabricated or foreign section is rejected by every honest validator", "An explicit BREAKING CHANGE marker can never be talked away", "Failed rounds revert without recording anything"].map((t) => h("li", {}, icon("check", 16), t)),
          ),
          h("div", { class: "powered-by" }, genlayerLogo(34), h("div", {}, h("strong", {}, "Powered by GenLayer"), h("span", { class: "muted small" }, "Intelligent Contracts with validator-run LLM consensus"))),
        ),
        h("div", { class: "split-visual" }, consensusScene),
      ),
    ),

    h(
      "section",
      { class: "section alt" },
      h(
        "div",
        { class: "container" },
        h("div", { class: "section-head row" }, h("div", {}, h("span", { class: "eyebrow" }, "On-chain now"), h("h2", {}, "Latest registered packages")), h("a", { class: "btn btn-ghost", href: "#/explorer" }, "Open the explorer", icon("arrow", 16))),
        latestHost,
      ),
    ),

    h(
      "section",
      { class: "section" },
      h(
        "div",
        { class: "container" },
        h(
          "div",
          { class: "cta-panel" },
          h("div", { class: "cta-mochi" }, mochi({ mood: "think", size: 130 })),
          h("div", {}, h("h2", {}, "Check a release in a few minutes"), h("p", {}, "Connect a wallet, register a package, paste the link to its changelog and let the validators decide. Not sure the page parses? The free parser preview shows exactly what validators would see.")),
          h("div", { class: "cta-row" }, h("a", { class: "btn btn-light btn-lg", href: "#/audit" }, "Start an audit"), h("a", { class: "btn btn-outline-light btn-lg", href: "#/tools" }, "Try the parser preview")),
        ),
      ),
    ),
  );

  async function loadStats() {
    try {
      const s = await api.stats();
      const tile = (label, value, iconName) => h("div", { class: "hero-stat" }, icon(iconName, 16), h("b", {}, value), h("span", {}, label));
      statsHost.replaceChildren(
        tile("packages", s.packages, "package"),
        tile("releases", s.releases, "tag"),
        tile("audits", s.audits, "file"),
        tile("integrity", pct(s.integrity_permille), "shield"),
      );
      if (!s.packages) {
        latestHost.replaceChildren(emptyState({ title: "No packages registered yet", text: "Be the first: register a package and audit one of its releases.", mood: "sleep", action: h("a", { class: "btn btn-primary", href: "#/audit" }, "Register a package") }));
        return;
      }
      const count = Math.min(6, s.packages);
      const page = await api.listPackages(s.packages - count, count);
      latestHost.replaceChildren(h("div", { class: "card-grid cols-3" }, [...page.items].reverse().map(packageCard)));
    } catch (err) {
      statsHost.replaceChildren(h("span", { class: "muted small" }, "Live numbers are unavailable right now."));
      latestHost.replaceChildren(emptyState({ title: "Can't reach Studionet", text: "The shared simulator may be restarting, or the public RPC is rate limited. Reload in a moment.", mood: "alert" }));
    }
  }

  return {
    el,
    async mounted() {
      loadStats();
      const { mountScene } = await import("../components/scene3d.js");
      if (destroyed) return;
      const reduced = motionReduced();
      const a = mountScene(heroScene, { variant: "hero", reduced });
      if (a) heroScene.querySelector(".scene-fallback")?.remove();
      scene = a;
      observer = new IntersectionObserver((entries, obs) => {
        if (entries[0].isIntersecting && !destroyed) {
          obs.disconnect();
          const b = mountScene(consensusScene, { variant: "consensus", reduced });
          if (b) consensusScene.querySelector(".scene-fallback")?.remove();
          consensus = b;
        }
      }, { rootMargin: "200px" });
      observer.observe(consensusScene);
    },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      scene?.destroy();
      consensus?.destroy();
    },
  };
}

export { packageCard };
