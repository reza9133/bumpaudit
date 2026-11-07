import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { CONFIG, explorerAddress } from "../config.js";
import { THEMES, themeStore, setTheme } from "../lib/theme.js";
import { wallet, disconnect, switchNetwork, fundAccount, onRightChain } from "../lib/wallet.js";
import { shortAddr } from "../lib/format.js";
import { currentPath } from "../lib/router.js";
import { bumpLogo, wordmark } from "./brand.js";
import { openWalletModal } from "./walletModal.js";
import { copyText } from "../lib/dom.js";
import { toast } from "./toast.js";
import { spinRing } from "./spinners.js";

const NAV = [
  { href: "/explorer", label: "Explorer", icon: "layers" },
  { href: "/audit", label: "Audit", icon: "zap" },
  { href: "/tools", label: "Tools", icon: "sliders" },
  { href: "/docs", label: "Docs", icon: "book" },
  { href: "/about", label: "About", icon: "info" },
];

export function renderHeader() {
  const nav = h(
    "nav",
    { class: "nav", "aria-label": "Main" },
    NAV.map((n) => h("a", { href: "#" + n.href, class: "nav-link", "data-href": n.href }, icon(n.icon, 16), n.label)),
  );

  const themeSwitch = h(
    "div",
    { class: "theme-switch", role: "radiogroup", "aria-label": "Theme" },
    THEMES.map((t) =>
      h("button", { class: "ts-btn", role: "radio", "data-theme-id": t.id, title: `${t.label} theme`, "aria-label": `${t.label} theme`, onclick: () => setTheme(t.id) }, icon(t.icon, 16)),
    ),
    h("i", { class: "ts-thumb" }),
  );
  const paintTheme = (s) => {
    const idx = THEMES.findIndex((t) => t.id === s.theme);
    themeSwitch.style.setProperty("--i", Math.max(0, idx));
    themeSwitch.querySelectorAll(".ts-btn").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeId === s.theme)));
  };
  themeStore.subscribe(paintTheme);
  paintTheme(themeStore.get());

  const walletSlot = h("div", { class: "wallet-slot" });
  let menuOpen = false;
  const closeMenu = () => {
    menuOpen = false;
    walletSlot.querySelector(".wallet-menu")?.remove();
    walletSlot.querySelector(".wallet-btn")?.setAttribute("aria-expanded", "false");
  };
  document.addEventListener("click", (e) => {
    if (menuOpen && !walletSlot.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());

  const paintWallet = (s) => {
    menuOpen = false;
    walletSlot.replaceChildren();
    if (s.status === "connecting") {
      walletSlot.append(h("button", { class: "btn btn-primary", disabled: true }, spinRing(14), "Connecting…"));
      return;
    }
    if (s.status !== "connected") {
      walletSlot.append(h("button", { class: "btn btn-primary btn-glow", onclick: openWalletModal }, icon("wallet", 16), h("span", { class: "hide-sm" }, "Connect wallet"), h("span", { class: "show-sm" }, "Connect")));
      return;
    }
    const ok = onRightChain(s);
    const btn = h(
      "button",
      {
        class: "wallet-btn",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        onclick: (e) => {
          e.stopPropagation();
          if (menuOpen) return closeMenu();
          menuOpen = true;
          btn.setAttribute("aria-expanded", "true");
          walletSlot.append(buildMenu(wallet.get()));
        },
      },
      s.active?.icon?.startsWith("data:image/") ? h("img", { src: s.active.icon, alt: "", width: 20, height: 20 }) : icon("wallet", 16),
      h("span", { class: "net-dot " + (ok ? "ok" : "bad"), title: ok ? CONFIG.chain.name : "Wrong network" }),
      h("code", {}, shortAddr(s.account)),
      icon("down", 14),
    );
    walletSlot.append(btn);
  };

  const buildMenu = (s) => {
    const ok = onRightChain(s);
    return h(
      "div",
      { class: "wallet-menu", role: "menu" },
      h("div", { class: "wm-head" }, h("strong", {}, s.active?.name || "Wallet"), h("span", { class: "muted small" }, s.balance !== null ? `${s.balance} GEN` : "balance …")),
      h("div", { class: "wm-net " + (ok ? "ok" : "bad") }, h("span", { class: "net-dot " + (ok ? "ok" : "bad") }), ok ? CONFIG.chain.name : `Wrong network (chain ${s.chainId ?? "?"})`),
      !ok ? h("button", { role: "menuitem", class: "wm-item accent", onclick: () => { closeMenu(); switchNetwork().catch(() => {}); } }, icon("refresh", 16), `Switch to ${CONFIG.chain.name}`) : null,
      h("button", { role: "menuitem", class: "wm-item", onclick: async () => { await copyText(s.account); toast({ type: "success", title: "Address copied", message: s.account }); closeMenu(); } }, icon("copy", 16), "Copy address"),
      h("a", { role: "menuitem", class: "wm-item", href: explorerAddress(s.account), target: "_blank", rel: "noopener noreferrer" }, icon("external", 16), "View on explorer"),
      h("a", { role: "menuitem", class: "wm-item", href: "#/audit?tab=mine", onclick: closeMenu }, icon("package", 16), "My packages"),
      h("button", { role: "menuitem", class: "wm-item", onclick: () => { closeMenu(); fundAccount(); } }, icon("droplet", 16), "Get test GEN"),
      h("button", { role: "menuitem", class: "wm-item danger", onclick: () => { closeMenu(); disconnect(); } }, icon("power", 16), "Disconnect"),
    );
  };

  wallet.subscribe((s) => {
    // Repaint on state change, but keep an open menu fresh.
    const wasOpen = menuOpen;
    paintWallet(s);
    if (wasOpen && s.status === "connected") {
      menuOpen = true;
      walletSlot.querySelector(".wallet-btn")?.setAttribute("aria-expanded", "true");
      walletSlot.append(buildMenu(s));
    }
  });
  paintWallet(wallet.get());

  const burger = h("button", { class: "icon-btn burger", "aria-label": "Menu", "aria-expanded": "false", onclick: () => {
    const open = header.classList.toggle("menu-open");
    burger.setAttribute("aria-expanded", String(open));
  } }, icon("menu", 22));

  const header = h(
    "header",
    { class: "site-header" },
    h(
      "div",
      { class: "container header-row" },
      h("a", { href: "#/", class: "brand", "aria-label": "BumpAudit home" }, bumpLogo(34), wordmark()),
      nav,
      h("div", { class: "header-tools" }, themeSwitch, walletSlot, burger),
    ),
  );

  const markActive = () => {
    const path = currentPath();
    nav.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", path === a.dataset.href || path.startsWith(a.dataset.href + "/")));
    header.classList.remove("menu-open");
    burger.setAttribute("aria-expanded", "false");
  };
  window.addEventListener("ba:route", markActive);
  markActive();

  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  return header;
}
