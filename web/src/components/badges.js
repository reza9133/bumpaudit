import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { copyText } from "../lib/dom.js";
import { verdictLabel, verdictTone, shortAddr, pct } from "../lib/format.js";
import { explorerAddress } from "../config.js";
import { toast } from "./toast.js";

const VERDICT_ICON = { COMPLIANT: "check", UNDER_BUMPED: "alert", OVER_BUMPED: "up", EXEMPT: "shield" };

export function verdictBadge(verdict, { big = false } = {}) {
  if (!verdict) return h("span", { class: "badge badge-neutral" }, "Not audited");
  return h("span", { class: `badge badge-${verdictTone(verdict)} ${big ? "badge-big" : ""}` }, icon(VERDICT_ICON[verdict] || "info", big ? 18 : 14), verdictLabel(verdict));
}

export function severityBadge(severity) {
  const tone = { BREAKING: "bad", FEATURE: "info", FIX: "ok", NONE: "neutral" }[severity] || "neutral";
  return h("span", { class: `badge badge-${tone}` }, String(severity || "NONE").toLowerCase());
}

export function bumpChip(bump) {
  return h("span", { class: `bump bump-${String(bump || "").toLowerCase()}` }, bump || "—");
}

export function ecoBadge(eco) {
  return h("span", { class: "eco" }, eco);
}

export function flag(kind, text) {
  const iconName = { edited: "edit", softened: "alert", injection: "alert", pre: "tag" }[kind] || "info";
  return h("span", { class: `flag flag-${kind}` }, icon(iconName, 13), text);
}

export function copyBtn(text, label = "Copy") {
  return h(
    "button",
    {
      class: "icon-btn",
      title: label,
      "aria-label": label,
      onclick: async (e) => {
        const ok = await copyText(text);
        const btn = e.currentTarget;
        btn.classList.toggle("copied", ok);
        setTimeout(() => btn.classList.remove("copied"), 1200);
        if (!ok) toast({ type: "error", title: "Copy failed", message: "Select the text and copy it manually." });
      },
    },
    icon("copy", 15),
  );
}

export function addrChip(address, { explorer = true } = {}) {
  if (!address) return h("span", { class: "muted" }, "—");
  return h(
    "span",
    { class: "addr" },
    explorer
      ? h("a", { href: explorerAddress(address), target: "_blank", rel: "noopener noreferrer", title: address }, h("code", {}, shortAddr(address)))
      : h("code", { title: address }, shortAddr(address)),
    copyBtn(address, "Copy address"),
  );
}

/** Integrity ring. permille is 0..1000 or null (nothing judged yet). */
export function gauge(permille, { size = 84, label = true } = {}) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const has = permille !== null && permille !== undefined;
  const value = has ? Math.max(0, Math.min(1000, Number(permille))) / 1000 : 0;
  const tone = !has ? "neutral" : value >= 0.9 ? "ok" : value >= 0.6 ? "warn" : "bad";
  const arc = h("svg:circle", { class: "g-arc", cx: 50, cy: 50, r, "stroke-dasharray": c.toFixed(2), "stroke-dashoffset": c.toFixed(2) });
  const svg = h("svg:svg", { viewBox: "0 0 100 100", width: size, height: size, role: "img", "aria-label": has ? `Integrity ${pct(permille)}` : "Integrity not rated yet" }, h("svg:circle", { class: "g-track", cx: 50, cy: 50, r }), arc);
  requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute("stroke-dashoffset", (c * (1 - value)).toFixed(2))));
  return h("div", { class: `gauge gauge-${tone}`, style: { width: size + "px", height: size + "px" } }, svg, label ? h("span", { class: "g-val", style: { fontSize: Math.max(11, Math.round(size * 0.19)) + "px" } }, has ? pct(permille) : "n/a") : null);
}

export function stat(label, value, hint, iconName) {
  return h("div", { class: "stat" }, iconName ? h("span", { class: "stat-ico" }, icon(iconName, 18)) : null, h("div", {}, h("div", { class: "stat-val" }, value), h("div", { class: "stat-label" }, label), hint ? h("div", { class: "stat-hint" }, hint) : null));
}

/** A segmented bar of verdict counts for a package. */
export function verdictBar(p) {
  const parts = [
    ["ok", p.compliant, "compliant"],
    ["warn", p.over_bumped, "over-bumped"],
    ["bad", p.under_bumped, "under-bumped"],
    ["neutral", p.exempt, "exempt"],
  ];
  const total = parts.reduce((a, [, n]) => a + n, 0);
  if (!total) return h("div", { class: "vbar vbar-empty", title: "No audited releases yet" });
  return h(
    "div",
    { class: "vbar", role: "img", "aria-label": parts.map(([, n, l]) => `${n} ${l}`).join(", ") },
    parts.filter(([, n]) => n).map(([tone, n, l]) => h("i", { class: "vb-" + tone, style: { flexGrow: n }, title: `${n} ${l}` })),
  );
}
