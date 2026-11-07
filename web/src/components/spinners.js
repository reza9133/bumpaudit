import { h } from "../lib/dom.js";
import { mochi } from "./brand.js";
import { bumpLogo } from "./brand.js";

/** Three version bars that bump upward in turn. */
export function spinBump(label = "Loading") {
  return h("span", { class: "spin-bump", role: "status", "aria-label": label }, h("i"), h("i"), h("i"), h("i"));
}

/** The logo with three orbiting dots. */
export function spinOrbit(size = 72) {
  return h("span", { class: "spin-orbit", style: { "--size": size + "px" }, role: "status", "aria-label": "Loading" }, h("span"), h("span"), h("span"), bumpLogo(size * 0.5));
}

/** A rotating 3D cube (pure CSS) used while validators work on a transaction. */
export function spinCube(size = 64) {
  const face = (cls) => h("i", { class: "cube-face " + cls }, bumpLogo(size * 0.5));
  return h(
    "span",
    { class: "spin-cube", style: { "--cube": size + "px" }, role: "status", "aria-label": "Waiting for validators" },
    h("span", { class: "cube" }, face("f-front"), face("f-back"), face("f-right"), face("f-left"), face("f-top"), face("f-bottom")),
  );
}

/** Small inline ring for buttons. */
export function spinRing(size = 16) {
  return h("span", { class: "spin-ring", style: { width: size + "px", height: size + "px" }, "aria-hidden": "true" });
}

export function pageLoader(text = "Mochi is fetching the latest audits…") {
  return h("div", { class: "page-loader" }, spinOrbit(84), h("p", {}, text));
}

export function skeleton(lines = 3, cls = "") {
  return h("div", { class: "skeleton " + cls }, Array.from({ length: lines }, (_, i) => h("i", { style: { width: 100 - ((i * 17) % 40) + "%" } })));
}

export function skeletonGrid(count = 6) {
  return h("div", { class: "card-grid" }, Array.from({ length: count }, () => h("div", { class: "card skeleton-card" }, skeleton(4))));
}

export { mochi };
