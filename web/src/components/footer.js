import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { CONFIG, explorerAddress } from "../config.js";
import { bumpLogo, wordmark, genlayerLogo, mochi } from "./brand.js";
import { shortAddr } from "../lib/format.js";
import { copyBtn } from "./badges.js";

export function renderFooter() {
  const address = CONFIG.contractAddress;
  return h(
    "footer",
    { class: "site-footer" },
    h(
      "div",
      { class: "container footer-grid" },
      h(
        "div",
        { class: "foot-brand" },
        h("a", { href: "#/", class: "brand" }, bumpLogo(32), wordmark()),
        h("p", { class: "muted" }, "An on-chain audit of whether version numbers tell the truth. AI proposes, plain code disposes, GenLayer validators agree."),
        h("div", { class: "powered" }, h("span", { class: "muted small" }, "Powered by"), h("a", { href: CONFIG.links.genlayer, target: "_blank", rel: "noopener noreferrer", class: "powered-link" }, genlayerLogo(22), h("b", {}, "GenLayer"))),
      ),
      h(
        "div",
        {},
        h("h4", {}, "Product"),
        h("a", { href: "#/explorer" }, "Explorer"),
        h("a", { href: "#/audit" }, "Audit a release"),
        h("a", { href: "#/tools" }, "Parser & rules tools"),
        h("a", { href: "#/settings" }, "Settings"),
      ),
      h(
        "div",
        {},
        h("h4", {}, "Learn"),
        h("a", { href: "#/docs/introduction" }, "Documentation"),
        h("a", { href: "#/docs/rules" }, "The rules"),
        h("a", { href: "#/docs/contract-api" }, "Contract API"),
        h("a", { href: "#/docs/security" }, "Security & limits"),
      ),
      h(
        "div",
        {},
        h("h4", {}, "Community"),
        h("a", { href: CONFIG.links.github, target: "_blank", rel: "noopener noreferrer", class: "with-ico" }, icon("github", 16), "GitHub"),
        h("a", { href: CONFIG.links.x, target: "_blank", rel: "noopener noreferrer", class: "with-ico" }, icon("xsocial", 15), "@amirhp771"),
        h("a", { href: CONFIG.links.genlayerDocs, target: "_blank", rel: "noopener noreferrer", class: "with-ico" }, icon("book", 16), "GenLayer docs"),
        h("div", { class: "foot-mochi" }, mochi({ mood: "happy", size: 76 })),
      ),
    ),
    h(
      "div",
      { class: "container footer-bar" },
      h("span", { class: "muted small" }, `© ${new Date().getFullYear()} BumpAudit · Open source on GitHub · Studionet is a shared simulator, state may be reset.`),
      h(
        "span",
        { class: "contract-line small" },
        "Contract ",
        h("a", { href: explorerAddress(address), target: "_blank", rel: "noopener noreferrer" }, h("code", {}, shortAddr(address, 8, 6))),
        copyBtn(address, "Copy contract address"),
      ),
    ),
  );
}
