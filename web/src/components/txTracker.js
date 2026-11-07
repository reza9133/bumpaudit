import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { explorerTx } from "../config.js";
import { explainError } from "../lib/errors.js";
import { runWrite, waitForFinality } from "../lib/tx.js";
import { shortHash } from "../lib/format.js";
import { spinCube } from "./spinners.js";
import { mochi } from "./brand.js";
import { copyBtn, } from "./badges.js";
import { toast } from "./toast.js";

const STEPS = [
  { key: "wallet", label: "Sign", text: "Confirm the transaction in your wallet." },
  { key: "PENDING", label: "Queued", text: "The transaction is waiting for a validator slot." },
  { key: "PROPOSING", label: "Proposing", text: "The leader validator fetches the release page and classifies each entry." },
  { key: "COMMITTING", label: "Voting", text: "Every other validator re-fetches the page itself and checks the leader's evidence." },
  { key: "REVEALING", label: "Revealing", text: "Votes are revealed and compared." },
  { key: "ACCEPTED", label: "Accepted", text: "Consensus reached and the result is stored." },
  { key: "FINALIZED", label: "Finalized", text: "The appeal window closed. The result is final." },
];

function stepIndex(evt) {
  if (evt.phase === "network" || evt.phase === "wallet") return 0;
  if (evt.phase === "submitted") return 1;
  if (evt.phase === "finalized") return 6;
  const status = evt.status;
  if (status === "READY_TO_FINALIZE") return 5;
  const idx = STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 1;
}

export function createTracker({ title, subtitle }) {
  let current = 0;
  let timer = 0;
  const startedAt = Date.now();
  const msg = h("p", { class: "tx-msg" }, "Preparing…");
  const clock = h("span", { class: "tx-clock" }, "0:00");
  const hash = h("div", { class: "tx-hash", hidden: true });
  const actions = h("div", { class: "tx-actions" });
  const visual = h("div", { class: "tx-visual" }, spinCube(64));
  const list = h(
    "ol",
    { class: "tx-steps" },
    STEPS.map((s) => h("li", { "data-key": s.key, title: s.text }, h("span", { class: "dot" }), h("span", {}, s.label))),
  );
  const el = h(
    "section",
    { class: "tx-panel card glow-border", "aria-live": "polite" },
    h("div", { class: "tx-head" }, visual, h("div", { class: "tx-title" }, h("h3", {}, title), subtitle ? h("p", { class: "muted small" }, subtitle) : null, msg), clock),
    list,
    hash,
    actions,
  );

  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  timer = setInterval(tick, 1000);

  function paint(idx, state = "active") {
    current = Math.max(current, idx);
    [...list.children].forEach((li, i) => {
      li.classList.toggle("done", i < current || (i === current && state === "done"));
      li.classList.toggle("active", i === current && state === "active");
      li.classList.toggle("failed", i === current && state === "failed");
    });
  }

  const api = {
    el,
    update(evt) {
      if (evt.hash && hash.hidden) {
        hash.hidden = false;
        hash.append(icon("hash", 14), "Transaction ", h("a", { href: explorerTx(evt.hash), target: "_blank", rel: "noopener noreferrer" }, h("code", {}, shortHash(evt.hash))), copyBtn(evt.hash, "Copy transaction hash"));
      }
      const idx = stepIndex(evt);
      const step = STEPS[idx];
      paint(idx, idx >= 5 ? "done" : "active");
      msg.textContent = evt.message || step.text;
      if (evt.phase === "accepted") el.classList.add("accepted");
    },
    fail(err) {
      clearInterval(timer);
      const info = explainError(err);
      paint(current, "failed");
      el.classList.remove("accepted");
      el.classList.add("failed");
      visual.replaceChildren(mochi({ mood: info.kind === "user" ? "think" : "alert", size: 84 }));
      msg.textContent = "";
      msg.append(h("strong", {}, info.kind === "user" ? "Cancelled. " : "Not recorded. "), info.message);
      if (info.hint) msg.append(h("span", { class: "muted" }, " " + info.hint));
      const hashValue = err?.hash;
      if (hashValue && hash.hidden) {
        hash.hidden = false;
        hash.append(icon("hash", 14), "Transaction ", h("a", { href: explorerTx(hashValue), target: "_blank", rel: "noopener noreferrer" }, h("code", {}, shortHash(hashValue))));
      }
    },
    /** Resolves once the transaction is final, or earlier if the user chooses to continue. */
    waitFinal(finalizedPromise) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          actions.replaceChildren();
          resolve(ok);
        };
        msg.textContent = "Accepted by the validators. Waiting for finality before showing this as confirmed…";
        paint(5, "done");
        actions.replaceChildren(
          h("button", { class: "btn btn-ghost btn-sm", onclick: () => { toast({ type: "info", title: "Showing the accepted result", message: "It is not final until the appeal window closes. The tracker keeps watching." }); finish(false); } }, "Continue with the accepted result"),
        );
        finalizedPromise.then((ok) => {
          if (ok) {
            paint(6, "done");
            api.succeed("Finalized. This result is final.");
          }
          finish(ok);
        });
      });
    },
    succeed(text = "Done.") {
      clearInterval(timer);
      el.classList.add("accepted");
      visual.replaceChildren(mochi({ mood: "cheer", size: 84 }));
      msg.textContent = text;
      [...list.children].forEach((li, i) => li.classList.toggle("done", i <= current));
    },
    acceptedOnly(text = "Accepted by the validators.") {
      clearInterval(timer);
      el.classList.add("accepted");
      visual.replaceChildren(mochi({ mood: "cheer", size: 84 }));
      msg.textContent = text;
    },
    stop() {
      clearInterval(timer);
    },
  };
  paint(0);
  return api;
}

/**
 * Runs a write with a live tracker mounted in `host`.
 * Returns { hash, tx, finalized, final } on success, or null if it failed (the tracker explains why).
 */
export async function trackedWrite({ fn, args, title, subtitle, host }) {
  const tracker = createTracker({ title, subtitle });
  host.replaceChildren(tracker.el);
  tracker.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const result = await runWrite({ fn, args, onUpdate: tracker.update });
    let final = false;
    if (waitForFinality()) {
      final = await tracker.waitFinal(result.finalized);
      if (!final) tracker.acceptedOnly("Accepted by the validators. Finality is still pending; the result below is provisional.");
    } else {
      tracker.acceptedOnly("Accepted by the validators. Finality is still pending, so treat the result as provisional.");
    }
    result.final = final;
    return result;
  } catch (err) {
    tracker.fail(err);
    return null;
  }
}
