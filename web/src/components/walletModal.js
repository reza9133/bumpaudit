import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { wallet, connect, refreshDiscovery } from "../lib/wallet.js";
import { mochi } from "./brand.js";

let open = null;

export function closeWalletModal() {
  open?.close();
}

export function openWalletModal() {
  if (open) return;
  const previouslyFocused = document.activeElement;
  const list = h("div", { class: "wallet-list" });
  const note = h("p", { class: "muted small" }, "Wallets are discovered with EIP-6963, so every installed wallet shows up here and none of them can hijack another.");

  const paint = (state) => {
    list.replaceChildren();
    if (!state.providers.length) {
      list.append(
        h(
          "div",
          { class: "empty-state compact" },
          mochi({ mood: "sleep", size: 90 }),
          h("h3", {}, "No wallet found"),
          h("p", {}, "Install an EIP-6963 compatible browser wallet such as MetaMask, Rabby or Coinbase Wallet, then rescan."),
          h("button", { class: "btn btn-ghost", onclick: refreshDiscovery }, icon("refresh", 16), "Rescan"),
        ),
      );
      return;
    }
    for (const p of state.providers) {
      list.append(
        h(
          "button",
          {
            class: "wallet-option",
            disabled: state.status === "connecting",
            onclick: async () => {
              if (await connect(p.uuid)) modal.close();
            },
          },
          p.icon && p.icon.startsWith("data:image/") ? h("img", { src: p.icon, alt: "", width: 36, height: 36 }) : h("span", { class: "wallet-fallback" }, icon("wallet", 20)),
          h("span", { class: "wo-name" }, p.name, p.rdns ? h("small", {}, p.rdns) : null),
          state.status === "connecting" ? h("span", { class: "muted small" }, "Check your wallet…") : icon("right", 18),
        ),
      );
    }
  };
  const unsubscribe = wallet.subscribe(paint);

  const onKey = (e) => {
    if (e.key === "Escape") modal.close();
    if (e.key === "Tab") {
      const focusable = [...overlay.querySelectorAll("button:not([disabled]), a[href]")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const overlay = h(
    "div",
    { class: "overlay", onclick: (e) => e.target === overlay && modal.close() },
    h(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "wm-title" },
      h("div", { class: "modal-head" }, h("h2", { id: "wm-title" }, "Connect a wallet"), h("button", { class: "icon-btn", "aria-label": "Close", onclick: () => modal.close() }, icon("x", 18))),
      h("p", { class: "muted" }, "Choose the wallet you want to use with BumpAudit. You approve the connection inside the wallet."),
      list,
      note,
    ),
  );
  const modal = {
    close() {
      unsubscribe();
      document.removeEventListener("keydown", onKey);
      overlay.classList.add("leaving");
      setTimeout(() => overlay.remove(), 200);
      open = null;
      previouslyFocused?.focus?.();
    },
  };
  open = modal;
  paint(wallet.get());
  refreshDiscovery();
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  overlay.querySelector("button.wallet-option, .modal-head button")?.focus();
}
