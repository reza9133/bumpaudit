// Tiny DOM helpers. Chain data is only ever inserted as text nodes, never as HTML.
const SVG_NS = "http://www.w3.org/2000/svg";

export function h(tag, props, ...children) {
  const isSvg = tag.startsWith("svg:");
  const el = isSvg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.setAttribute("class", value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key === "html") el.innerHTML = value; // trusted static markup only
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "ref" && typeof value === "function") value(el);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Only allow plain https links coming from chain data. */
export function safeHref(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function link(href, children, props = {}) {
  const safe = safeHref(href);
  return safe
    ? h("a", { href: safe, target: "_blank", rel: "noopener noreferrer", ...props }, children)
    : h("span", props, children);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { style: { position: "fixed", opacity: "0" } });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
