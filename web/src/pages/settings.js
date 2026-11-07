import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { CONFIG } from "../config.js";
import { prefs } from "../lib/store.js";
import { THEMES, themeStore, setTheme, setReducedMotion } from "../lib/theme.js";
import { invalidateAll } from "../lib/chain.js";
import { toast } from "../components/toast.js";
import { addrChip } from "../components/badges.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function render() {
  const themeHost = h("div", { class: "theme-tiles", role: "radiogroup", "aria-label": "Theme" });
  const paintThemes = (s = themeStore.get()) => {
    themeHost.replaceChildren(
      ...THEMES.map((t) =>
        h("button", { class: "theme-tile" + (s.theme === t.id ? " active" : ""), "data-preview": t.id, role: "radio", "aria-checked": String(s.theme === t.id), onclick: () => setTheme(t.id) },
          h("span", { class: "tt-preview" }, h("i", { class: "tt-bar" }), h("i", { class: "tt-line" }), h("i", { class: "tt-line short" }), h("i", { class: "tt-chip" })),
          h("span", { class: "tt-label" }, icon(t.icon, 16), t.label),
        ),
      ),
    );
  };
  const unsub = themeStore.subscribe(paintThemes);
  paintThemes();

  const motion = h("input", { type: "checkbox", checked: themeStore.get().reduced, onchange: (e) => setReducedMotion(e.target.checked) });
  const final = h("input", { type: "checkbox", checked: prefs.get("waitFinal", "1") !== "0", onchange: (e) => prefs.set("waitFinal", e.target.checked ? "1" : "0") });

  const addr = h("input", { type: "text", value: prefs.get("contract", "") || "", placeholder: CONFIG.defaultContract, spellcheck: "false", autocomplete: "off" });
  const addrMsg = h("span", { class: "field-msg" });
  const current = h("div", {}, addrChip(CONFIG.contractAddress));

  const el = h(
    "div",
    { class: "container page narrow" },
    h("div", { class: "page-head" }, h("div", {}, h("span", { class: "eyebrow" }, "Settings"), h("h1", {}, "Preferences"), h("p", { class: "muted" }, "Stored only in this browser."))),
    h("section", { class: "card form" }, h("h3", {}, "Theme"), h("p", { class: "muted" }, "Light, a softer Dim in between, and Dark. Your choice is remembered."), themeHost),
    h("section", { class: "card form" },
      h("h3", {}, "Motion & confirmations"),
      h("label", { class: "switch-row" }, motion, h("span", {}, h("strong", {}, "Reduce motion"), h("small", { class: "muted" }, "Freezes the 3D scenes and decorative animations. Also follows your system setting."))),
      h("label", { class: "switch-row" }, final, h("span", {}, h("strong", {}, "Wait for finality before confirming"), h("small", { class: "muted" }, "After validators accept a transaction, keep watching until it is FINALIZED. You can always continue early."))),
    ),
    h("section", { class: "card form" },
      h("h3", {}, "Contract address"),
      h("p", { class: "muted" }, "The site talks to this BumpAudit deployment. Override it to test your own deployment; the override only applies in this browser."),
      current,
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Override address"), addr, addrMsg),
      h("div", { class: "cta-row" },
        h("button", { class: "btn btn-primary", onclick: () => {
          const v = addr.value.trim();
          if (!ADDRESS_RE.test(v)) { addrMsg.className = "field-msg bad"; addrMsg.textContent = "Enter a 0x address with 40 hex characters."; return; }
          prefs.set("contract", v);
          invalidateAll();
          toast({ type: "success", title: "Contract address updated", message: "Reloading with the new address…" });
          setTimeout(() => location.reload(), 600);
        } }, "Save and reload"),
        h("button", { class: "btn btn-ghost", onclick: () => { prefs.set("contract", null); invalidateAll(); toast({ type: "info", title: "Default restored", message: CONFIG.defaultContract }); setTimeout(() => location.reload(), 600); } }, "Use the default"),
      ),
    ),
    h("section", { class: "card form" }, h("h3", {}, "Network"), h("dl", { class: "kv" }, h("dt", {}, "Name"), h("dd", {}, CONFIG.chain.name), h("dt", {}, "Chain ID"), h("dd", {}, `${CONFIG.chain.id} (${CONFIG.chain.hex})`), h("dt", {}, "RPC"), h("dd", {}, h("code", {}, CONFIG.chain.rpc)), h("dt", {}, "Request budget"), h("dd", {}, `${CONFIG.rpcPerMinute} requests per minute (the public RPC allows about 30)`))),
    h("section", { class: "card form" }, h("h3", {}, "Local data"), h("p", { class: "muted" }, "Clears theme, motion, wallet and contract preferences saved by this site."), h("button", { class: "btn btn-ghost", onclick: () => { ["theme", "motion", "wallet", "wallet.off", "waitFinal", "contract"].forEach((k) => prefs.set(k, null)); toast({ type: "info", title: "Preferences cleared", message: "Reloading…" }); setTimeout(() => location.reload(), 500); } }, icon("refresh", 16), "Reset all preferences")),
  );
  return { el, destroy: unsub };
}
