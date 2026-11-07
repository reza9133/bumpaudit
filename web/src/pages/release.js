import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { link } from "../lib/dom.js";
import { api, invalidateAll } from "../lib/chain.js";
import { CONFIG } from "../config.js";
import { fmtDate, shortHash, timeAgo } from "../lib/format.js";
import { wallet, onRightChain } from "../lib/wallet.js";
import { keccakHex, sameHash } from "../lib/hash.js";
import { addrChip, bumpChip, copyBtn, flag, severityBadge, verdictBadge } from "../components/badges.js";
import { skeleton, spinRing } from "../components/spinners.js";
import { errorState, notice } from "../components/states.js";
import { trackedWrite } from "../components/txTracker.js";
import { openWalletModal } from "../components/walletModal.js";
import { mochi } from "../components/brand.js";

export function auditCard(a, release, { open = false } = {}) {
  const notesHost = h("div", { class: "notes-host" });
  let loaded = false;
  const toggle = h("button", { class: "btn btn-ghost btn-sm" }, icon("eye", 15), "Show audited text & verify hash");
  toggle.addEventListener("click", async () => {
    if (loaded) {
      notesHost.replaceChildren();
      loaded = false;
      toggle.replaceChildren(icon("eye", 15), "Show audited text & verify hash");
      return;
    }
    toggle.disabled = true;
    notesHost.replaceChildren(skeleton(5));
    try {
      const n = await api.notes(a.id);
      const verifyOut = h("span", { class: "verify-out" });
      const verifyBtn = h("button", { class: "btn btn-primary btn-sm" }, icon("shield", 15), "Verify hash in this browser");
      verifyBtn.addEventListener("click", async () => {
        verifyBtn.disabled = true;
        verifyBtn.replaceChildren(spinRing(14), "Hashing…");
        try {
          const local = await keccakHex(n.block);
          const ok = sameHash(local, a.block_hash);
          verifyOut.className = "verify-out " + (ok ? "ok" : "bad");
          verifyOut.replaceChildren(icon(ok ? "check" : "alert", 16), ok ? "Match: the stored text hashes to the on-chain value." : "Mismatch: the text does not hash to the on-chain value!");
          if (!ok) verifyOut.append(h("code", { class: "break" }, ` local ${local}`));
        } catch (err) {
          verifyOut.className = "verify-out bad";
          verifyOut.replaceChildren(icon("alert", 16), "Could not compute the hash in this browser.");
        } finally {
          verifyBtn.disabled = false;
          verifyBtn.replaceChildren(icon("shield", 15), "Verify again");
        }
      });
      notesHost.replaceChildren(
        h("div", { class: "hash-row" }, h("span", { class: "muted small" }, "keccak256"), h("code", { class: "break" }, a.block_hash), copyBtn(a.block_hash, "Copy hash")),
        h("pre", { class: "notes-pre", tabindex: "0" }, n.block || "(empty)"),
        h("div", { class: "verify-row" }, verifyBtn, verifyOut),
      );
      loaded = true;
      toggle.replaceChildren(icon("x", 15), "Hide audited text");
    } catch (err) {
      notesHost.replaceChildren(errorState(err));
    } finally {
      toggle.disabled = false;
    }
  });

  const counts = h(
    "div",
    { class: "counts" },
    h("span", { title: "Entries read" }, icon("list", 14), `${a.item_count} entries`),
    h("span", { class: "c-bad" }, `${a.breaking_entries} breaking`),
    h("span", { class: "c-info" }, `${a.feature_entries} feature`),
    h("span", { class: "c-ok" }, `${a.fix_entries} fix`),
    a.explicit_markers ? h("span", { title: "Entries that literally say BREAKING CHANGE or use feat!: style markers" }, icon("lock", 14), `${a.explicit_markers} explicit marker${a.explicit_markers === 1 ? "" : "s"}`) : null,
  );

  const el = h(
    "article",
    { class: "audit-card card" },
    h(
      "header",
      { class: "audit-head" },
      h("div", {}, h("h3", {}, `Audit #${a.id}`), h("span", { class: "muted small" }, `${fmtDate(a.created_at)} · requested by `), addrChip(a.requester)),
      h("div", { class: "audit-badges" }, verdictBadge(a.verdict), severityBadge(a.severity), a.notes_changed ? flag("edited", "notes changed") : null, a.softened ? flag("softened", "softened") : null, a.injection_flagged ? flag("injection", "text addressed the classifier") : null),
    ),
    h("div", { class: "audit-bumps" }, "Declared ", bumpChip(a.declared_bump), icon("arrow", 14), "honest bump needed ", bumpChip(a.required_bump)),
    counts,
    a.evidence?.length
      ? h("div", { class: "evidence" }, h("h4", {}, "Evidence quoted from the page"), a.evidence.map((e) => h("blockquote", {}, h("span", { class: "ev-i" }, `#${e.i}`), h("span", {}, e.t))))
      : h("p", { class: "muted small" }, "No deciding entries were cited (nothing in the notes rose above a fix)."),
    h("div", {}, toggle),
    notesHost,
  );
  if (open) queueMicrotask(() => toggle.click());
  return el;
}

export async function render({ params }) {
  const id = Number(params.id);
  const el = h("div", { class: "container page" }, skeleton(6, "tall"));
  let timer = 0;
  if (!Number.isInteger(id) || id < 1) {
    el.replaceChildren(errorState(new Error("That is not a valid release id.")));
    return { el };
  }

  async function load(force = false) {
    clearInterval(timer);
    try {
      const r = await api.release(id, { force });
      const [pkg, audits] = await Promise.all([api.pkg(r.package_id, { force }), api.audits(id, 0, 50, { force })]);
      const trackerHost = h("div", {});
      const cooldownLabel = h("span", {});
      const reBtn = h("button", { class: "btn btn-primary" });

      const left = () => Math.max(0, r.last_checked_at + CONFIG.minReauditSeconds - Math.floor(Date.now() / 1000));
      const paintBtn = () => {
        const s = wallet.get();
        const wait = left();
        reBtn.disabled = wait > 0 && s.status === "connected";
        reBtn.replaceChildren(icon("refresh", 16), s.status !== "connected" ? "Connect wallet to re-check" : wait > 0 ? `Available in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}` : "Re-read the pinned URL");
        cooldownLabel.textContent = wait > 0 ? "A re-check is only allowed every 5 minutes per release." : "Ready. This costs a consensus round and is recorded only if something changed.";
      };
      reBtn.addEventListener("click", async () => {
        if (wallet.get().status !== "connected") return openWalletModal();
        reBtn.disabled = true;
        const res = await trackedWrite({ fn: "reaudit_release", args: [id], title: "Re-reading the pinned release notes", subtitle: "Validators fetch the same URL again and compare it with the stored section.", host: trackerHost });
        invalidateAll();
        if (res) {
          const fresh = await api.release(id, { force: true });
          const changed = fresh.audit_count > r.audit_count;
          trackerHost.append(
            changed
              ? notice("warn", h("strong", {}, "Something changed. "), fresh.softened && !r.softened ? "The notes were softened: they now read less severe than before." : "A new audit was recorded for this release.")
              : notice("ok", h("strong", {}, "Nothing changed. "), "The section and its severity match the stored audit. Only the last-checked time moved; no audit slot was used."),
            h("button", { class: "btn btn-ghost", onclick: () => load(true) }, icon("refresh", 16), "Reload this release"),
          );
        } else paintBtn();
      });
      paintBtn();
      timer = setInterval(paintBtn, 1000);

      const tamper = h(
        "div",
        { class: "card" },
        h("h3", {}, icon("shield", 18), "Tamper evidence"),
        h("dl", { class: "kv" },
          h("dt", {}, "First section hash"), h("dd", {}, h("code", { title: r.first_block_hash }, shortHash(r.first_block_hash, 14, 8)), copyBtn(r.first_block_hash, "Copy hash")),
          h("dt", {}, "Latest section hash"), h("dd", {}, h("code", { title: r.latest_block_hash }, shortHash(r.latest_block_hash, 14, 8)), copyBtn(r.latest_block_hash, "Copy hash")),
          h("dt", {}, "Times edited"), h("dd", {}, r.edit_count ? flag("edited", `${r.edit_count}`) : "0 (never changed)"),
          h("dt", {}, "Softened"), h("dd", {}, r.softened ? flag("softened", "yes, permanently flagged") : "no"),
          h("dt", {}, "Verdict changes"), h("dd", {}, String(r.verdict_changes)),
          h("dt", {}, "Quiet re-checks"), h("dd", {}, String(r.check_count)),
          h("dt", {}, "Last checked"), h("dd", {}, `${fmtDate(r.last_checked_at)} (${timeAgo(r.last_checked_at)})`),
        ),
      );

      el.replaceChildren(
        h("a", { class: "back-link", href: `#/package/${pkg.id}` }, icon("right", 14, { style: "transform:rotate(180deg)" }), `${pkg.name}`),
        h(
          "section",
          { class: "card release-hero" },
          h(
            "div",
            { class: "rh-main" },
            h("div", { class: "muted small" }, h("a", { href: `#/package/${pkg.id}` }, pkg.name), ` · ${pkg.ecosystem} · release #${r.id}`),
            h("h1", { class: "ver-line" }, h("code", {}, r.previous_version), icon("arrow", 28), h("code", { class: "grad" }, r.version)),
            h("div", { class: "rh-chips" }, "Declared ", bumpChip(r.declared_bump), severityBadge(r.severity), r.initial_development ? flag("pre", "0.y.z initial development") : null, r.prerelease ? flag("pre", "pre-release") : null, r.edit_count ? flag("edited", "notes edited") : null, r.softened ? flag("softened", "softened") : null),
            h("p", { class: "src" }, icon("link", 15), h("span", { class: "muted" }, "Pinned source: "), link(r.notes_url, [r.notes_url, icon("external", 13)], { class: "break" })),
          ),
          h("div", { class: "stamp-wrap" }, h("div", { class: "stamp" }, verdictBadge(r.verdict, { big: true })), h("span", { class: "muted small" }, `${r.audit_count} audit${r.audit_count === 1 ? "" : "s"} recorded`)),
        ),
        h("div", { class: "two-col" }, tamper, h("div", { class: "card" }, h("h3", {}, icon("refresh", 18), "Re-check this release"), h("p", { class: "muted" }, "Re-reads the same pinned URL. It can never be pointed at friendlier evidence, and spamming re-checks cannot hide an edit."), reBtn, h("p", { class: "muted small" }, cooldownLabel))),
        trackerHost,
        h("h2", {}, "Audit history"),
        audits.items.length
          ? h("div", { class: "audit-list" }, [...audits.items].reverse().map((a, i) => auditCard(a, r, { open: false })))
          : h("p", { class: "muted" }, "No audits recorded."),
      );
    } catch (err) {
      el.replaceChildren(errorState(err, () => load(true)));
    }
  }
  load();
  return { el, destroy: () => clearInterval(timer) };
}
