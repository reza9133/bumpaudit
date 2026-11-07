import { h } from "../lib/dom.js";
import { mochi } from "../components/brand.js";

export async function render() {
  return {
    el: h("div", { class: "container page" }, h("div", { class: "empty-state big" }, mochi({ mood: "alert", size: 150 }), h("h1", {}, "404"), h("h3", {}, "That page does not exist"), h("p", { class: "muted" }, "Mochi looked everywhere, even under the changelog."), h("div", { class: "cta-row" }, h("a", { class: "btn btn-primary", href: "#/" }, "Back home"), h("a", { class: "btn btn-ghost", href: "#/explorer" }, "Open the explorer")))),
  };
}
