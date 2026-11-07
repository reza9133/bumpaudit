import { h } from "../lib/dom.js";
import { mochi } from "./brand.js";
import { explainError } from "../lib/errors.js";
import { icon } from "../lib/icons.js";

export function emptyState({ title, text, mood = "sleep", action, size = 110 }) {
  return h(
    "div",
    { class: "empty-state" },
    mochi({ mood, size }),
    h("h3", {}, title),
    text ? h("p", {}, text) : null,
    action || null,
  );
}

export function errorState(err, retry) {
  const info = explainError(err);
  return h(
    "div",
    { class: "empty-state error-state", role: "alert" },
    mochi({ mood: "alert", size: 110 }),
    h("h3", {}, info.kind === "network" || info.kind === "rate" ? "Can't reach the network right now" : "Something went wrong"),
    h("p", {}, info.message),
    info.hint ? h("p", { class: "muted" }, info.hint) : null,
    retry ? h("button", { class: "btn btn-primary", onclick: retry }, icon("refresh", 16), "Try again") : null,
  );
}

export function notice(kind, ...children) {
  const name = { info: "info", warn: "alert", error: "alert", ok: "check" }[kind] || "info";
  return h("div", { class: `notice notice-${kind}`, role: kind === "error" ? "alert" : "note" }, icon(name, 18), h("div", {}, ...children));
}
