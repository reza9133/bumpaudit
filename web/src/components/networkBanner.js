import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { CONFIG } from "../config.js";
import { wallet, switchNetwork } from "../lib/wallet.js";
import { rpcStatus } from "../lib/rpc.js";

/** Sticky banner shown whenever a connected wallet is on the wrong network, plus an RPC throttle hint. */
export function networkBanner() {
  const root = h("div", { class: "net-banner-host" });
  const throttle = h("div", { class: "rpc-chip", role: "status", hidden: true }, icon("clock", 14), h("span", {}, "Pausing to respect the public RPC limit…"));
  document.body.append(throttle);

  const paint = (s) => {
    root.replaceChildren();
    if (s.status === "connected" && s.chainId !== CONFIG.chain.id) {
      root.append(
        h(
          "div",
          { class: "net-banner", role: "alert" },
          icon("alert", 18),
          h(
            "span",
            {},
            h("strong", {}, "Wrong network. "),
            `Your wallet is on chain ${s.chainId ?? "unknown"}, but BumpAudit runs on ${CONFIG.chain.name} (chain ${CONFIG.chain.id}). Switch to send transactions.`,
          ),
          h(
            "button",
            { class: "btn btn-sm btn-light", disabled: s.switching, onclick: () => switchNetwork().catch(() => {}) },
            s.switching ? "Waiting for wallet…" : `Switch to ${CONFIG.chain.name}`,
          ),
        ),
      );
    }
  };
  wallet.subscribe(paint);
  paint(wallet.get());
  rpcStatus.subscribe((s) => {
    throttle.hidden = !s.waiting;
  });
  return root;
}
