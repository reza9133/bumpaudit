import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { CONFIG, explorerAddress } from "../config.js";
import { bumpLogo, genlayerLogo, mochi, wordmark } from "../components/brand.js";
import { addrChip } from "../components/badges.js";
import { tilt } from "../components/tilt.js";

export async function render() {
  const el = h(
    "div",
    { class: "container page" },
    h("div", { class: "about-hero" }, h("div", {}, h("span", { class: "eyebrow" }, "About"), h("h1", {}, "Honest version numbers, on-chain"), h("p", { class: "lead" }, "BumpAudit turns a promise everyone makes and nobody checks into a public, replayable record. Maintainers can prove they keep it. Users can see when they do not.")), h("div", { class: "about-logo" }, bumpLogo(150))),

    h("div", { class: "card-grid cols-3" },
      [["shield", "Evidence, not opinion", "Every verdict stores the exact section that was read, the entries that decided it and a Keccak-256 hash. Anyone can re-check it offline."], ["users", "Agreement, not trust", "Several GenLayer validators fetch the page and judge it independently. A lying leader or a prompt-injected page cannot push text into state."], ["eye", "Tamper evident", "Re-checks re-read the same pinned URL. Notes edited later, or breaking lines quietly deleted, are flagged on the release for good."]].map(([ic, t, p]) => tilt(h("article", { class: "card step-card" }, h("span", { class: "step-ico" }, icon(ic, 24)), h("h3", {}, t), h("p", {}, p)))),
    ),

    h("section", { class: "split about-split" },
      h("div", { class: "split-copy" }, h("span", { class: "eyebrow" }, "Built on"), h("h2", {}, "GenLayer Intelligent Contracts"), h("p", { class: "muted" }, "GenLayer is a blockchain whose contracts can read the web and call language models, with validators reaching consensus on the non-deterministic result. BumpAudit uses exactly that: a model reads the release notes, and consensus makes the answer trustworthy."), h("div", { class: "cta-row" }, h("a", { class: "btn btn-ghost", href: CONFIG.links.genlayer, target: "_blank", rel: "noopener noreferrer" }, "genlayer.com", icon("external", 14)), h("a", { class: "btn btn-ghost", href: CONFIG.links.genlayerDocs, target: "_blank", rel: "noopener noreferrer" }, "GenLayer docs", icon("external", 14)))),
      h("div", { class: "gl-showcase card glow-border" }, genlayerLogo(150), h("span", { class: "muted small" }, "GenLayer")),
    ),

    h("section", { class: "mochi-section card" },
      h("div", { class: "mochi-stage" }, mochi({ mood: "happy", size: 230 })),
      h("div", { class: "mochi-copy" },
        h("span", { class: "eyebrow" }, "The mascot"),
        h("h2", {}, "Meet Mochi"),
        h("p", { class: "muted" }, "Mochi is the project's mascot, a cat-astronaut robot in a painter's outfit. It cheers on compliant releases, squints at suspicious ones, naps when there is nothing to read and keeps you company while validators work. You will find it across the site."),
        h("div", { class: "mochi-row" }, [["happy", "Happy", "all good"], ["think", "Thinking", "validators reading"], ["cheer", "Cheering", "compliant"], ["alert", "Alert", "mismatch found"], ["sleep", "Napping", "nothing here yet"]].map(([m, label, when]) => h("figure", {}, mochi({ mood: m, size: 96 }), h("figcaption", {}, h("strong", {}, label), h("span", {}, when))))),
      ),
    ),

    h("section", {},
      h("h2", {}, "Project links"),
      h("div", { class: "card-grid cols-3" },
        h("a", { class: "card link-card", href: CONFIG.links.github, target: "_blank", rel: "noopener noreferrer" }, icon("github", 26), h("div", {}, h("strong", {}, "GitHub"), h("span", { class: "muted small" }, "reza9133/bumpaudit: contract, tests, scripts")), icon("external", 16)),
        h("a", { class: "card link-card", href: CONFIG.links.x, target: "_blank", rel: "noopener noreferrer" }, icon("xsocial", 24), h("div", {}, h("strong", {}, "@amirhp771 on X"), h("span", { class: "muted small" }, "Updates and questions")), icon("external", 16)),
        h("a", { class: "card link-card", href: explorerAddress(CONFIG.contractAddress), target: "_blank", rel: "noopener noreferrer" }, icon("cube", 26), h("div", {}, h("strong", {}, "Contract on the explorer"), h("span", { class: "muted small" }, "Studionet")), icon("external", 16)),
      ),
    ),

    h("section", { class: "card" }, h("h3", {}, "Deployed contract"), h("dl", { class: "kv" }, h("dt", {}, "Address"), h("dd", {}, addrChip(CONFIG.contractAddress)), h("dt", {}, "Network"), h("dd", {}, `${CONFIG.chain.name} · chain ${CONFIG.chain.id}`), h("dt", {}, "RPC"), h("dd", {}, h("code", {}, CONFIG.chain.rpc)))),

    h("p", { class: "muted small center" }, "Built with genlayer-js, Three.js and plain JavaScript. No tracking, no analytics, no cookies."),
  );
  return { el };
}
