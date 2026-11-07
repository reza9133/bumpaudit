import { h, mount } from "./dom.js";
import { pageLoader } from "../components/spinners.js";

const routes = [];
let outlet;
let current = null;
let token = 0;

export function route(pattern, load, title) {
  const keys = [];
  const source = pattern.replace(/:([a-z]+)/gi, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({ regex: new RegExp(`^${source}/?$`), keys, load, title });
}

export function navigate(path) {
  if (location.hash === "#" + path) handle();
  else location.hash = path;
}

export const currentPath = () => (location.hash.slice(1).split("?")[0] || "/");

export function parseQuery() {
  const raw = location.hash.split("?")[1] || "";
  return Object.fromEntries(new URLSearchParams(raw));
}

async function handle() {
  const path = currentPath();
  const mine = ++token;
  let matched = null;
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (m) {
      matched = { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      break;
    }
  }
  try {
    current?.destroy?.();
  } catch {
    /* ignore */
  }
  current = null;
  window.dispatchEvent(new CustomEvent("ba:route", { detail: path }));
  mount(outlet, pageLoader());
  let page;
  try {
    const target = matched ? matched.route : routes.find((r) => r.notFound);
    const mod = await target.load();
    if (mine !== token) return;
    page = await mod.render({ params: matched?.params || {}, query: parseQuery(), path });
    document.title = (target.title ? target.title(matched?.params || {}) + " · " : "") + "BumpAudit";
  } catch (err) {
    if (mine !== token) return;
    console.error(err);
    const { errorState } = await import("../components/states.js");
    page = { el: errorState(err) };
  }
  if (mine !== token) return;
  current = page;
  const wrapper = h("div", { class: "page-enter" }, page.el);
  mount(outlet, wrapper);
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  page.mounted?.();
}

export function startRouter(el) {
  outlet = el;
  window.addEventListener("hashchange", handle);
  handle();
}

export function notFound(load) {
  routes.push({ regex: /^$/, keys: [], load, notFound: true });
}
