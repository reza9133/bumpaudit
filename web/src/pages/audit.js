import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { debounce } from "../lib/dom.js";
import { api, invalidateAll } from "../lib/chain.js";
import { CONFIG, ECOSYSTEMS } from "../config.js";
import { wallet, onRightChain, fundAccount, switchNetwork } from "../lib/wallet.js";
import { inspectBump } from "../lib/semver.js";
import { bumpChip, ecoBadge } from "../components/badges.js";
import { notice, emptyState } from "../components/states.js";
import { trackedWrite } from "../components/txTracker.js";
import { openWalletModal } from "../components/walletModal.js";
import { explainError } from "../lib/errors.js";
import { auditCard } from "./release.js";
import { spinRing } from "../components/spinners.js";
import { navigate } from "../lib/router.js";
import { mochi } from "../components/brand.js";

let pageSubs = [];
let tabSubs = [];
const watchPage = (fn) => pageSubs.push(wallet.subscribe(fn));
const watchTab = (fn) => tabSubs.push(wallet.subscribe(fn));
const dropSubs = (list) => list.splice(0).forEach((u) => u());

const NAME_RE = /^[A-Za-z0-9@][A-Za-z0-9._\-@/+]{0,79}$/;

function field(label, input, hint, extra) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), input, hint ? h("span", { class: "field-hint" }, hint) : null, extra || null);
}

function gate() {
  const host = h("div", {});
  const paint = (s) => {
    host.replaceChildren();
    if (s.status !== "connected") {
      host.append(h("div", { class: "card gate" }, mochi({ mood: "think", size: 80 }), h("div", {}, h("h3", {}, "Connect a wallet to write to the contract"), h("p", { class: "muted" }, "Reading is free and needs no wallet. Registering and auditing are transactions.")), h("button", { class: "btn btn-primary", onclick: openWalletModal }, icon("wallet", 16), "Connect wallet")));
    } else if (!onRightChain(s)) {
      host.append(h("div", { class: "card gate warn" }, icon("alert", 28), h("div", {}, h("h3", {}, "Switch your wallet to GenLayer Studionet"), h("p", { class: "muted" }, `Your wallet is on chain ${s.chainId ?? "?"}. This contract lives on chain ${CONFIG.chain.id}.`)), h("button", { class: "btn btn-primary", disabled: s.switching, onclick: () => switchNetwork().catch(() => {}) }, icon("refresh", 16), s.switching ? "Waiting for wallet…" : "Switch network")));
    } else {
      host.append(h("div", { class: "gate-ok" }, icon("check", 16), `Ready on ${CONFIG.chain.name}`, s.balance !== null ? h("span", { class: "muted" }, ` · ${s.balance} GEN`) : null, h("button", { class: "btn btn-link btn-sm", onclick: fundAccount }, icon("droplet", 14), "Get test GEN")));
    }
  };
  watchPage(paint);
  paint(wallet.get());
  return host;
}

function submitLabel(s, text) {
  if (s.status !== "connected") return "Connect wallet to continue";
  if (!onRightChain(s)) return "Switch network to continue";
  return text;
}

async function guardedSubmit(run) {
  const s = wallet.get();
  if (s.status !== "connected") return openWalletModal();
  if (!onRightChain(s)) return switchNetwork().catch(() => {});
  return run();
}

function registerForm() {
  const name = h("input", { type: "text", maxlength: 80, placeholder: "acme-widget", autocomplete: "off", spellcheck: "false" });
  const eco = h("select", {}, ECOSYSTEMS.map((e) => h("option", { value: e }, e)));
  const prefix = h("input", { type: "url", maxlength: 500, placeholder: "https://github.com/acme/widget/releases/", autocomplete: "off", spellcheck: "false" });
  const nameMsg = h("span", { class: "field-msg" });
  const prefixMsg = h("span", { class: "field-msg" });
  const host = h("div", {});
  const submit = h("button", { class: "btn btn-primary btn-lg btn-glow", type: "submit" });
  let prefixOk = null;

  const checkName = () => {
    const v = name.value.trim();
    nameMsg.className = "field-msg";
    nameMsg.textContent = "";
    if (!v) return false;
    if (!NAME_RE.test(v)) {
      nameMsg.className = "field-msg bad";
      nameMsg.textContent = "1-80 characters from A-Z a-z 0-9 . _ - @ / + , starting with a letter, digit or @.";
      return false;
    }
    return true;
  };
  const checkPrefix = async () => {
    const v = prefix.value.trim();
    prefixMsg.className = "field-msg";
    prefixMsg.textContent = "";
    prefixOk = null;
    if (!v) return;
    if (!/^https:\/\/[^/]+\/.+/.test(v)) {
      prefixOk = false;
      prefixMsg.className = "field-msg bad";
      prefixMsg.textContent = "Must be a public https:// URL on a domain name, with a path.";
      return;
    }
    prefixMsg.textContent = "Checking with the contract…";
    try {
      const res = await api.checkUrl(v, true);
      prefixOk = res.valid;
      prefixMsg.className = "field-msg " + (res.valid ? "ok" : "bad");
      prefixMsg.textContent = res.valid ? `Accepted as ${res.canonical}` : "The contract would reject this prefix (no IP addresses, ports, userinfo, query, fragment or dot-segments).";
    } catch {
      prefixMsg.textContent = "";
    }
  };
  name.addEventListener("input", debounce(checkName, 250));
  prefix.addEventListener("blur", checkPrefix);

  const paintSubmit = (s = wallet.get()) => {
    submit.replaceChildren(icon("package", 18), submitLabel(s, "Register package"));
  };
  watchTab(paintSubmit);
  paintSubmit();

  const form = h(
    "form",
    {
      class: "form card",
      onsubmit: (e) => {
        e.preventDefault();
        guardedSubmit(async () => {
          if (!checkName()) return name.focus();
          if (prefixOk === false) return prefix.focus();
          const n = name.value.trim();
          const p = prefix.value.trim();
          if (!n || !p) return;
          submit.disabled = true;
          const res = await trackedWrite({ fn: "register_package", args: [n, eco.value, p], title: `Registering ${n}`, subtitle: "This is a plain transaction: validators only need to agree that it executes the same way.", host });
          submit.disabled = false;
          if (!res) return;
          try {
            invalidateAll();
            const fresh = (await api.registrantPackages(wallet.get().account)).items;
            const found = [...fresh].reverse().find((x) => x.name.toLowerCase() === n.toLowerCase() && x.ecosystem === eco.value);
            host.append(
              found
                ? h("div", { class: "card result-card" }, mochi({ mood: "cheer", size: 90 }), h("div", {}, h("h3", {}, `Registered as package #${found.id}`), h("p", { class: "muted" }, "Now audit one of its releases."), h("div", { class: "cta-row" }, h("a", { class: "btn btn-primary", href: `#/audit?tab=audit&pkg=${found.id}` }, icon("zap", 16), "Audit a release"), h("a", { class: "btn btn-ghost", href: `#/package/${found.id}` }, "Open package page"))))
                : notice("ok", "Registered. Open the Explorer to find your package."),
            );
          } catch {
            host.append(notice("ok", "Registered. Open the Explorer to find your package."));
          }
        });
      },
    },
    h("h2", {}, "Register a package"),
    h("p", { class: "muted" }, "Pins where this package's release notes may come from. Every audit must cite a page below the prefix."),
    h("div", { class: "form-grid" }, field("Package name", name, null, nameMsg), field("Ecosystem", eco)),
    field("Source prefix", prefix, "Pick the narrowest prefix only maintainers can write to, such as the releases page or the raw CHANGELOG.md path. Issue and pull-request pages are user-writable.", prefixMsg),
    submit,
  );
  return h("div", {}, form, host);
}

function auditForm(query) {
  const pkgId = h("input", { type: "number", min: 1, placeholder: "e.g. 1", value: query.pkg || "", class: "short" });
  const pkgInfo = h("div", { class: "pkg-info muted small" });
  const prev = h("input", { type: "text", maxlength: 64, placeholder: "1.4.2", autocomplete: "off", spellcheck: "false" });
  const ver = h("input", { type: "text", maxlength: 64, placeholder: "1.4.3", autocomplete: "off", spellcheck: "false" });
  const url = h("input", { type: "url", maxlength: 500, placeholder: "https://github.com/acme/widget/releases/tag/v1.4.3", autocomplete: "off", spellcheck: "false" });
  const bumpLine = h("div", { class: "bump-line" });
  const urlMsg = h("span", { class: "field-msg" });
  const host = h("div", {});
  const submit = h("button", { class: "btn btn-primary btn-lg btn-glow", type: "submit" });
  let pkg = null;

  const loadPkg = async () => {
    pkg = null;
    const n = Number(pkgId.value);
    pkgInfo.replaceChildren();
    if (!Number.isInteger(n) || n < 1) return;
    pkgInfo.textContent = "Looking up the package…";
    try {
      pkg = await api.pkg(n);
      pkgInfo.replaceChildren(icon("package", 14), h("strong", {}, pkg.name), ecoBadge(pkg.ecosystem), " source prefix ", h("code", { class: "break" }, pkg.source_prefix));
      checkUrl();
    } catch (err) {
      pkgInfo.replaceChildren(h("span", { class: "bad" }, explainError(err).message));
    }
  };
  const checkUrl = () => {
    urlMsg.className = "field-msg";
    urlMsg.textContent = "";
    const u = url.value.trim();
    if (!u || !pkg) return;
    if (!u.toLowerCase().startsWith(pkg.source_prefix.toLowerCase())) {
      urlMsg.className = "field-msg warn";
      urlMsg.textContent = "This URL does not appear to be below the package's source prefix. The contract will reject it if it is not.";
    }
  };
  const paintBump = () => {
    const r = inspectBump(prev.value.trim(), ver.value.trim());
    bumpLine.replaceChildren();
    if (r.state === "empty") return;
    if (r.state === "error") return bumpLine.append(h("span", { class: "bad" }, icon("alert", 14), r.message));
    bumpLine.append("Declared bump ", bumpChip(r.bump), r.prerelease ? h("span", { class: "flag flag-pre" }, "pre-release: audited but exempt from scoring") : null, r.initialDevelopment ? h("span", { class: "flag flag-pre" }, "0.y.z: MINOR is the breaking boundary") : null);
  };
  pkgId.addEventListener("change", loadPkg);
  pkgId.addEventListener("input", debounce(loadPkg, 500));
  url.addEventListener("input", debounce(checkUrl, 250));
  prev.addEventListener("input", paintBump);
  ver.addEventListener("input", paintBump);
  if (query.pkg) loadPkg();

  const paintSubmit = (s = wallet.get()) => submit.replaceChildren(icon("zap", 18), submitLabel(s, "Request audit"));
  watchTab(paintSubmit);
  paintSubmit();

  const form = h(
    "form",
    {
      class: "form card",
      onsubmit: (e) => {
        e.preventDefault();
        guardedSubmit(async () => {
          const id = Number(pkgId.value);
          const r = inspectBump(prev.value.trim(), ver.value.trim());
          if (!Number.isInteger(id) || id < 1) return pkgId.focus();
          if (r.state !== "ok") return ver.focus();
          if (!url.value.trim()) return url.focus();
          submit.disabled = true;
          const res = await trackedWrite({ fn: "audit_release", args: [id, ver.value.trim(), prev.value.trim(), url.value.trim()], title: `Auditing ${pkg?.name || "package #" + id} ${ver.value.trim()}`, subtitle: "Every validator fetches the page and runs its own classification. This usually takes one to three minutes.", host });
          submit.disabled = false;
          if (!res) return;
          try {
            invalidateAll();
            const release = await api.findRelease(id, ver.value.trim());
            const audit = await api.audit(release.latest_audit_id);
            host.append(
              h("div", { class: "result-reveal" }, h("h3", {}, "Verdict"), auditCard(audit, release), h("div", { class: "cta-row" }, h("a", { class: "btn btn-primary", href: `#/release/${release.id}` }, "Open the release page", icon("arrow", 16)), h("a", { class: "btn btn-ghost", href: `#/package/${id}` }, "Package page"))),
            );
          } catch (err) {
            host.append(notice("ok", "The audit was accepted. Open the package page to see the verdict."));
          }
        });
      },
    },
    h("h2", {}, "Audit a release"),
    h("p", { class: "muted" }, "One consensus round per release. The URL is pinned to this release the first time it is audited."),
    field("Package id", pkgId, "Find it on the Explorer, or register a package first.", pkgInfo),
    h("div", { class: "form-grid" }, field("Previous stable version", prev, "A stable release, no pre-release tag."), field("Audited version", ver, "Must be higher than the previous one.")),
    bumpLine,
    field("Release notes URL", url, h("span", {}, "A GitHub release page, a CHANGELOG.md (raw or rendered) or a docs-site changelog below the source prefix. ", h("a", { href: "#/tools" }, "Preview the parser first (free).")), urlMsg),
    submit,
  );
  return h("div", {}, form, host);
}

function mineTab() {
  const host = h("div", {});
  const paint = async () => {
    const { account } = wallet.get();
    if (!account) {
      host.replaceChildren(emptyState({ title: "Connect a wallet", text: "Your packages are the ones registered from the connected address.", mood: "think", action: h("button", { class: "btn btn-primary", onclick: openWalletModal }, "Connect wallet") }));
      return;
    }
    host.replaceChildren(h("p", { class: "muted" }, h("span", {}, "Loading your packages "), spinRing(14)));
    try {
      const res = await api.registrantPackages(account);
      host.replaceChildren(
        res.items.length
          ? h("div", { class: "list" }, [...res.items].reverse().map((p) => h("div", { class: "card row-card" }, h("div", {}, h("a", { href: `#/package/${p.id}` }, h("strong", {}, p.name)), " ", ecoBadge(p.ecosystem), h("div", { class: "muted small break" }, p.source_prefix)), h("a", { class: "btn btn-primary btn-sm", href: `#/audit?tab=audit&pkg=${p.id}` }, icon("zap", 14), "Audit a release"))))
          : emptyState({ title: "You have not registered a package yet", mood: "sleep", action: h("a", { class: "btn btn-primary", href: "#/audit?tab=register" }, "Register one") }),
      );
    } catch (err) {
      host.replaceChildren(notice("error", explainError(err).message));
    }
  };
  paint();
  let last = wallet.get().account;
  watchTab((s) => { if (s.account !== last) { last = s.account; paint(); } });
  return { el: host };
}

export async function render({ query }) {
  let tab = ["register", "audit", "mine"].includes(query.tab) ? query.tab : "register";
  const body = h("div", {});
  const tabs = h("div", { class: "tabs", role: "tablist" });
  dropSubs(pageSubs);
  const paint = () => {
    dropSubs(tabSubs);
    tabs.replaceChildren(
      ...[["register", "Register package", "package"], ["audit", "Audit a release", "zap"], ["mine", "My packages", "wallet"]].map(([id, label, ic]) =>
        h("button", { class: "tab" + (tab === id ? " active" : ""), role: "tab", "aria-selected": String(tab === id), onclick: () => { tab = id; paint(); } }, icon(ic, 16), label),
      ),
    );
    if (tab === "register") body.replaceChildren(registerForm());
    else if (tab === "audit") body.replaceChildren(auditForm(query));
    else {
      body.replaceChildren(mineTab().el);
    }
  };
  paint();

  const el = h(
    "div",
    { class: "container page narrow" },
    h("div", { class: "page-head" }, h("div", {}, h("span", { class: "eyebrow" }, "Workbench"), h("h1", {}, "Register & audit"), h("p", { class: "muted" }, "Write to the contract on GenLayer Studionet. Results are shown once validators agree, and marked final when the appeal window closes."))),
    gate(),
    tabs,
    body,
  );
  return { el, destroy: () => { dropSubs(tabSubs); dropSubs(pageSubs); } };
}
