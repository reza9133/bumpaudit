import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

let host;
function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = h("div", { class: "toasts", role: "region", "aria-label": "Notifications", "aria-live": "polite" });
  document.body.append(host);
  return host;
}

const ICONS = { success: "check", error: "alert", warn: "alert", info: "info" };

/** toast({ type: success|error|warn|info, title, message, action: { label, run }, duration }) */
export function toast({ type = "info", title, message = "", action, duration }) {
  const root = ensureHost();
  const lifetime = duration ?? (type === "error" || action ? 9000 : 5200);
  const close = () => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 260);
  };
  const el = h(
    "div",
    { class: `toast toast-${type}`, role: type === "error" ? "alert" : "status" },
    h("span", { class: "toast-icon" }, icon(ICONS[type] || "info", 18)),
    h(
      "div",
      { class: "toast-body" },
      h("strong", {}, title),
      message ? h("p", {}, message) : null,
      action
        ? h(
            "button",
            {
              class: "btn btn-sm btn-ghost",
              onclick: () => {
                action.run();
                close();
              },
            },
            action.label,
          )
        : null,
    ),
    h("button", { class: "icon-btn toast-close", "aria-label": "Dismiss", onclick: close }, icon("x", 16)),
  );
  root.append(el);
  while (root.children.length > 4) root.firstChild.remove();
  if (lifetime > 0) setTimeout(close, lifetime);
  return close;
}
