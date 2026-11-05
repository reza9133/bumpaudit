#!/usr/bin/env node
/**
 * Live end-to-end adversarial test runner for BumpAudit on GenLayer Studionet.
 *
 *   npm run test:live            (= node --dns-result-order=ipv4first scripts/e2e.mjs)
 *   npm run test:all             static checks + local tests + this runner
 *
 * Scenarios, run in order (each one is real transactions against a real contract):
 *   0. preflight         RPC reachable, contract answers, the public fixture is the one we expect
 *   1. basics            registration, sequential ids, duplicates, same name elsewhere
 *   2. adversarial input hostile names / ecosystems / SSRF-style URLs / SemVer / prefix boundary; all must revert
 *                        with an [EXPECTED] tag and leave the contract untouched
 *   3. live AI consensus the three fixture audits, evidence, block hashes, integrity score
 *   4. re-audit + paging cooldown, unknown release, duplicate audit, pagination of every list view
 *
 * Environment
 *   BA_CONTRACT_ADDRESS   reuse a deployment (otherwise a fresh contract is deployed)
 *   BA_PRIVATE_KEY        acting account (otherwise a throw-away key, funded through sim_fundAccount)
 *   BA_FIXTURE_BASE       folder URL that serves CHANGELOG.md (default: the public reza9133/bumpaudit fixture)
 *   BA_E2E_QUICK=1        run only a representative sample of each adversarial table (about 15 reverts instead of ~50)
 *   BA_E2E_REPORT_DIR     where reports go (default ./reports)
 *   BA_RPC_PER_MINUTE     see scripts/throttle.mjs
 *
 * Exit code: 0 when every check passed, 1 otherwise. Reports are written even when scenarios fail or crash.
 *
 * Known quirks handled here: Node 24 needs IPv4 first (set below as well as in the npm script), and
 * preview_extraction is deliberately NOT called with the multi-line fixture: over gen_call it trips an RLP
 * length-prefix error. The parser is covered offline by the pytest suite instead.
 */
import dns from "node:dns";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAccount, deployContract, EXPLORER, fund, generatePrivateKey, makeClient, ROOT, send, view } from "./lib.mjs";
import { Recorder, writeReports } from "./report.mjs";
import { sleep, taggedMessage } from "./util.mjs";

dns.setDefaultResultOrder("ipv4first");

const DEFAULT_BASE = "https://raw.githubusercontent.com/reza9133/bumpaudit/main/examples/fixtures";
const BASE = (process.env.BA_FIXTURE_BASE || DEFAULT_BASE).trim().replace(/\/+$/, "");
const PREFIX = BASE + "/";
const NOTES = BASE + "/CHANGELOG.md";
const HOST = new URL(BASE).host;
const PATH = NOTES.slice(("https://" + HOST).length);
const QUICK = /^(1|true|yes)$/i.test(process.env.BA_E2E_QUICK ?? "");
const REPORT_DIR = resolve(process.env.BA_E2E_REPORT_DIR || resolve(ROOT, "reports"));
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^(0x)?[0-9a-f]{64}$/i;
const MISSING_ID = 9_999_999;

const rec = new Recorder();
const quiet = () => {};
const sample = (list) => (QUICK ? list.slice(0, 2) : list);
const shown = (text) => {
  const t = JSON.stringify(text);
  return t.length > 48 ? t.slice(0, 45) + '…"' : t;
};

// ---------------------------------------------------------------------------------------------
// setup: account, client, contract
// ---------------------------------------------------------------------------------------------
const key = process.env.BA_PRIVATE_KEY || generatePrivateKey();
const account = createAccount(key);
const client = makeClient(account);
const me = account.address.toLowerCase();
let address = (process.env.BA_CONTRACT_ADDRESS || "").trim();
let deployed = false;
let NAME = "acme-widget";

async function retry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}
const v = (fn, args = []) => retry(() => view(client, address, fn, args));

/** Sends a transaction that is supposed to succeed. Throws on revert. */
async function write(label, fn, args, log = console.log) {
  const out = await send(client, address, fn, args, log);
  rec.tx(label, out.hash);
  return out;
}

/** Sends a transaction that MUST revert with an [EXPECTED] tag containing `needle`. */
async function mustRevert(label, fn, args, needle) {
  try {
    const out = await send(client, address, fn, args, quiet);
    rec.tx(label, out.hash);
    rec.reverted(label, null, needle);
  } catch (err) {
    rec.tx(label, err.hash);
    rec.reverted(label, err, needle);
  }
}

/** A read call that must fail with a message containing `needle` (views have no transaction, so no tag is required). */
async function viewMustFail(label, fn, args, needle) {
  try {
    await view(client, address, fn, args);
    rec.check(label, false, "the call succeeded but had to fail");
  } catch (err) {
    const message = taggedMessage(err) ?? String(err?.shortMessage ?? err?.message ?? err);
    rec.check(label, message.toLowerCase().includes(needle.toLowerCase()), message);
  }
}

/** Id of the newest package this account registered (the contract returns it, but receipts do not expose return values reliably). */
async function lastRegisteredId() {
  const mine = await v("list_registrant_packages", [account.address]);
  return mine.items.length ? mine.items[mine.items.length - 1].id : null;
}

async function register(name, ecosystem, prefix) {
  const before = await v("get_stats");
  await write(`register_package ${name} ${ecosystem} ${prefix}`, "register_package", [name, ecosystem, prefix]);
  const id = await lastRegisteredId();
  return { id, before };
}

// ---------------------------------------------------------------------------------------------
// shared state between scenarios
// ---------------------------------------------------------------------------------------------
const ctx = { pkg: null, pkgMirror: null, pkgOther: null, pkgBoundary: null, baseline: null, releases: {}, limits: null };

// ---------------------------------------------------------------------------------------------
// 0. preflight
// ---------------------------------------------------------------------------------------------
async function preflight() {
  console.log(`  account  ${account.address}${process.env.BA_PRIVATE_KEY ? "" : "  (throw-away key)"}`);
  const funded = await fund(client, account.address);
  if (funded === true) rec.check("account funded through sim_fundAccount", true);
  else if (process.env.BA_PRIVATE_KEY) rec.note(`sim_fundAccount did not run (${funded}); assuming the supplied key is already funded`);
  else rec.check("account funded through sim_fundAccount", false, String(funded));

  if (address) {
    if (!ADDRESS_RE.test(address)) throw new Error(`BA_CONTRACT_ADDRESS is not an address: ${address}`);
    rec.note(`reusing the contract at ${address}`);
  } else {
    const out = await deployContract(client, (line) => console.log("  " + line));
    address = out.address;
    deployed = true;
    rec.tx("deploy", out.hash);
    rec.note(`deployed a fresh contract at ${address}`);
  }
  console.log(`  contract ${address}  ${EXPLORER}/contracts/${address}`);

  const version = await v("get_version");
  rec.check("contract answers get_version", typeof version === "string" && version.length > 0, `got ${JSON.stringify(version)}`);
  const limits = await v("get_limits");
  ctx.limits = limits;
  rec.check("get_limits reports the 300 s re-audit cooldown", limits.min_reaudit_interval_seconds === 300, `got ${limits.min_reaudit_interval_seconds}`);
  rec.check("npm and pypi are supported ecosystems", limits.ecosystems.includes("npm") && limits.ecosystems.includes("pypi"));

  ctx.baseline = await v("get_stats");
  if (deployed) {
    const empty = ctx.baseline.packages === 0 && ctx.baseline.releases === 0 && ctx.baseline.audits === 0;
    rec.check("fresh deployment starts empty", empty, empty ? "" : JSON.stringify(ctx.baseline));
  } else rec.note(`existing deployment: ${ctx.baseline.packages} package(s), ${ctx.baseline.releases} release(s), ${ctx.baseline.audits} audit(s) already stored; ids are checked relative to that`);

  // The validators fetch the page themselves, so it must be public and be the text these checks were written for.
  let remote = null;
  try {
    const res = await fetch(NOTES, { redirect: "follow" });
    rec.check(`fixture is publicly reachable (${NOTES})`, res.ok, `HTTP ${res.status}`);
    remote = res.ok ? await res.text() : null;
  } catch (err) {
    rec.check(`fixture is publicly reachable (${NOTES})`, false, String(err?.message ?? err));
  }
  if (remote !== null) {
    const local = readFileSync(resolve(ROOT, "examples", "fixtures", "CHANGELOG.md"), "utf8");
    const sha = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);
    const same = sha(remote) === sha(local);
    rec.check("hosted fixture matches examples/fixtures/CHANGELOG.md", same, same ? "" : `hosted ${sha(remote)} vs local ${sha(local)}: push the fixture or the AI scenario expectations will not hold`);
  }

  // Reusing a deployment that already holds this package would make every later "first time" expectation false.
  if (!deployed) {
    const existing = await v("find_packages", ["npm", NAME, 0, 50]);
    if (existing.items.some((p) => p.source_prefix === PREFIX)) {
      NAME = `acme-widget-${Date.now().toString(36)}`;
      rec.note(`acme-widget with this prefix already exists on that contract; using the run-unique name ${NAME}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 1. basics & registration
// ---------------------------------------------------------------------------------------------
async function basics() {
  const { id, before } = await register(NAME, "npm", PREFIX);
  ctx.pkg = id;
  rec.eq("first package id is sequential", id, before.packages + 1);
  const pkg = await v("get_package", [id]);
  rec.eq("get_package: name", pkg.name, NAME);
  rec.eq("get_package: ecosystem", pkg.ecosystem, "npm");
  rec.eq("get_package: source_prefix keeps the trailing slash", pkg.source_prefix, PREFIX);
  rec.eq("get_package: registrant is the sender", String(pkg.registrant).toLowerCase(), me);
  rec.eq("get_package: fresh counters", [pkg.releases, pkg.compliant, pkg.under_bumped, pkg.over_bumped, pkg.exempt, pkg.edited, pkg.softened, pkg.judged, pkg.last_audit_at], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  rec.eq("get_package: no integrity score before any judgement", pkg.integrity_permille, null);
  rec.check("get_package: created_at is set", pkg.created_at > 0, `got ${pkg.created_at}`);

  const after = await v("get_stats");
  rec.eq("get_stats: packages +1", after.packages, before.packages + 1);
  rec.eq("get_stats: releases and audits untouched", [after.releases, after.audits], [before.releases, before.audits]);
  const found = await v("find_packages", ["npm", NAME, 0, 50]);
  rec.check("find_packages lists the new package", found.items.some((p) => p.id === id), JSON.stringify(found.items.map((p) => p.id)));

  // exact duplicates, including spellings the contract normalises
  const dup = `already registered as package #${id}`;
  await mustRevert("exact duplicate is refused", "register_package", [NAME, "npm", PREFIX], dup);
  await mustRevert("duplicate with different name case is refused", "register_package", [NAME.toUpperCase(), "npm", PREFIX], dup);
  await mustRevert("duplicate with a padded, upper-case ecosystem is refused", "register_package", [NAME, "  NPM ", PREFIX], dup);
  const afterDup = await v("get_stats");
  rec.eq("duplicates did not create packages", afterDup.packages, before.packages + 1);

  // same name, other ecosystem / other source: separate, clearly labelled entries
  const mirror = await register(NAME, "pypi", PREFIX);
  ctx.pkgMirror = mirror.id;
  rec.eq("same name under another ecosystem gets the next id", mirror.id, id + 1);
  const other = await register(NAME, "npm", "https://github.com/acme/widget/");
  ctx.pkgOther = other.id;
  rec.eq("same name under another source prefix gets the next id", other.id, id + 2);
  const again = await v("find_packages", ["npm", NAME, 0, 50]);
  rec.check("find_packages(npm, name) now shows both npm entries", [id, other.id].every((x) => again.items.some((p) => p.id === x)), JSON.stringify(again.items.map((p) => p.id)));
  const pypi = await v("find_packages", ["pypi", NAME, 0, 50]);
  rec.check("find_packages(pypi, name) shows only the pypi entry", pypi.items.some((p) => p.id === mirror.id) && !pypi.items.some((p) => p.id === id), JSON.stringify(pypi.items.map((p) => p.id)));
  const prefixes = new Set([(await v("get_package", [id])).source_prefix, (await v("get_package", [other.id])).source_prefix]);
  rec.eq("the two npm entries keep their own prefixes", prefixes.size, 2);
}

// ---------------------------------------------------------------------------------------------
// 2. adversarial input validation
// ---------------------------------------------------------------------------------------------
async function adversarial() {
  if (!ctx.pkg) throw new Error("scenario 1 did not register the base package");

  // a package whose prefix has NO trailing slash, to test the path-boundary rule
  const boundary = await register(NAME, "other", BASE);
  ctx.pkgBoundary = boundary.id;
  rec.eq("boundary package registered (prefix without trailing slash)", boundary.id, ctx.pkg + 3);
  rec.eq("its prefix is stored as given", (await v("get_package", [boundary.id])).source_prefix, BASE);

  const statsBefore = await v("get_stats");
  const pkgBefore = await v("get_package", [ctx.pkg]);
  const listBefore = await v("list_registrant_packages", [account.address]);

  // ---- names ------------------------------------------------------------------
  const badNames = [
    ["blank", ""],
    ["whitespace only", "   "],
    ["81 characters (limit is 80)", "a".repeat(81)],
    ["space inside", "acme widget"],
    ["shell/markup characters", "acme<script>$(rm -rf)"],
    ["exclamation mark", "acme-widget!"],
    ["leading dash", "-acme"],
    ["leading dot / path traversal", "../../etc/passwd"],
    ["only punctuation", "@/+"],
    ["non-ASCII look-alike", "acme-wïdget"],
    ["right-to-left override", "acme\u202Etegdiw"],
  ];
  for (const [what, name] of sample(badNames)) await mustRevert(`name ${what} (${shown(name)})`, "register_package", [name, "npm", PREFIX], "name must be");

  // ---- ecosystems -------------------------------------------------------------
  const badEcosystems = [["python", "python"], ["unknown", "unknown"], ["empty", ""], ["injection attempt", "npm; DROP"]];
  for (const [what, eco] of sample(badEcosystems)) await mustRevert(`ecosystem ${what} (${shown(eco)})`, "register_package", [NAME + "-eco", eco, PREFIX], "ecosystem must be one of");

  // ---- source prefixes (hostile / SSRF) ----------------------------------------
  const badPrefixes = [
    ["IPv4 literal", "https://127.0.0.1/"],
    ["cloud metadata address", "https://169.254.169.254/latest/meta-data/"],
    ["plain http", "http://github.com/acme/widget/"],
    ["credentials in the URL", "https://u:p@github.com/acme/widget/"],
    ["non-standard port", "https://github.com:8443/acme/widget/"],
    ["dot-dot path traversal", "https://github.com/acme/../widget/"],
    ["localhost (no dot)", "https://localhost/acme/"],
    ["IPv6 literal", "https://[::1]/acme/"],
    ["hex-looking IP", "https://0x7f.0.0.1/acme/"],
    ["internal suffix", "https://build.internal/acme/"],
    ["wildcard DNS (nip.io)", "https://10.0.0.1.nip.io/acme/"],
    ["host only, no path", "https://github.com/"],
    ["query string", "https://github.com/acme/widget/?ref=main"],
    ["javascript: scheme", "javascript:alert(1)"],
  ];
  for (const [what, prefix] of sample(badPrefixes)) await mustRevert(`source_prefix ${what} (${shown(prefix)})`, "register_package", [NAME + "-ssrf", "npm", prefix], "source_prefix must be a public https");

  // The same policy through the free view, as an independent cross-check (one cheap call each).
  for (const [what, prefix] of sample(badPrefixes).slice(0, QUICK ? 2 : 8)) {
    const res = await v("check_source_url", [prefix, true]);
    rec.check(`check_source_url also rejects ${what}`, res.valid === false, JSON.stringify(res));
  }
  const good = await v("check_source_url", [PREFIX, true]);
  rec.check("check_source_url accepts the real fixture prefix", good.valid === true && good.canonical === PREFIX, JSON.stringify(good));

  // ---- SemVer violations in audit_release ---------------------------------------
  const semver = [
    ["version lower than previous", ["1.4.2", "1.4.3"], "version must be higher than previous_version"],
    ["version equal to previous", ["1.4.3", "1.4.3"], "version must be higher than previous_version"],
    ["version is 'latest'", ["latest", "1.4.3"], "version is not valid SemVer"],
    ["version has two parts", ["1.5", "1.4.3"], "version is not valid SemVer"],
    ["version has a leading zero", ["01.5.0", "1.4.3"], "version is not valid SemVer"],
    ["previous_version is 'main'", ["1.5.0", "main"], "previous_version is not valid SemVer"],
    ["previous_version has four parts", ["1.5.0", "1.4.3.1"], "previous_version is not valid SemVer"],
    ["previous_version is a pre-release", ["1.5.0", "1.4.3-rc.1"], "previous_version must be a stable release"],
  ];
  for (const [what, [version, previous], needle] of sample(semver)) await mustRevert(`audit_release: ${what} (${previous} -> ${version})`, "audit_release", [ctx.pkg, version, previous, NOTES], needle);
  await mustRevert("audit_release: unknown package id", "audit_release", [MISSING_ID, "1.5.0", "1.4.3", NOTES], "package not found");

  // ---- notes URL policy ---------------------------------------------------------
  const badNotes = [
    ["plain http", NOTES.replace(/^https:/, "http:")],
    ["IP literal", "https://127.0.0.1" + PATH],
    ["credentials", `https://u:p@${HOST}${PATH}`],
    ["non-standard port :8443", `https://${HOST}:8443${PATH}`],
    ["path traversal ../", `${BASE}/../../README.md`],
  ];
  for (const [what, url] of sample(badNotes)) await mustRevert(`notes_url ${what} (${shown(url)})`, "audit_release", [ctx.pkg, "1.5.0", "1.4.3", url], "notes_url must be a public https");

  const outside = [
    ["same host, outside the source prefix", `https://${HOST}/someone-else/other-repo/main/CHANGELOG.md`],
    ["another host entirely", "https://evil.example.org/CHANGELOG.md"],
    ["sibling folder that merely starts with the prefix text", `${BASE}-evil/CHANGELOG.md`],
  ];
  for (const [what, url] of sample(outside)) await mustRevert(`notes_url ${what}`, "audit_release", [ctx.pkg, "1.5.0", "1.4.3", url], "notes_url must be below this package's source prefix");

  // Strict boundary: this package's prefix is BASE (no slash), so only BASE itself or BASE/... or BASE?... may pass.
  await mustRevert("path boundary: <prefix>-evil/ is outside a slash-less prefix", "audit_release", [ctx.pkgBoundary, "1.5.0", "1.4.3", `${BASE}-evil/CHANGELOG.md`], "must be below this package's source prefix");
  await mustRevert("path boundary: <prefix>evil/ is outside a slash-less prefix", "audit_release", [ctx.pkgBoundary, "1.5.0", "1.4.3", `${BASE}evil/CHANGELOG.md`], "must be below this package's source prefix");

  // ---- nothing above may have changed any state ------------------------------------
  const statsAfter = await v("get_stats");
  rec.eq("get_stats identical after every rejected call", statsAfter, statsBefore);
  rec.eq("base package record identical after every rejected call", await v("get_package", [ctx.pkg]), pkgBefore);
  const listAfter = await v("list_registrant_packages", [account.address]);
  rec.eq("this account's package list is unchanged", listAfter.items.map((p) => p.id), listBefore.items.map((p) => p.id));
  rec.eq("no release was created by rejected audits", (await v("list_package_releases", [ctx.pkg, 0, 50])).total, 0);
}

// ---------------------------------------------------------------------------------------------
// 3. live AI consensus
// ---------------------------------------------------------------------------------------------
const CASES = [
  {
    version: "1.4.3",
    previous: "1.4.2",
    story: "PATCH that silently removes a flag",
    expect: { verdict: "UNDER_BUMPED", severity: "BREAKING", declared: "PATCH", required: "MAJOR" },
    quote: ["--legacy"],
    mustNotContain: ["streaming uploads"],
  },
  {
    version: "1.5.0",
    previous: "1.4.3",
    story: "MINOR that adds streaming uploads",
    expect: { verdict: "COMPLIANT", severity: "FEATURE", declared: "MINOR", required: "MINOR" },
    quote: ["streaming uploads"],
    mustNotContain: ["--legacy"],
  },
  {
    version: "2.0.0",
    previous: "1.5.0",
    story: "MAJOR that removes the connect() API",
    expect: { verdict: "COMPLIANT", severity: "BREAKING", declared: "MAJOR", required: "MAJOR" },
    quote: ["connect()"],
    mustNotContain: ["streaming uploads"],
  },
];

async function audits() {
  if (!ctx.pkg) throw new Error("no base package to audit against");
  let counted = { compliant: 0, under: 0 };
  for (const c of CASES) {
    console.log(`\n  -- audit ${c.previous} -> ${c.version}: ${c.story}`);
    const tag = `${c.previous} -> ${c.version}`;
    try {
      await write(`audit_release ${tag}`, "audit_release", [ctx.pkg, c.version, c.previous, NOTES]);
    } catch (err) {
      rec.check(`audit_release ${tag} was accepted by consensus`, false, `${err.tag ? `[${err.tag}] ` : ""}${err.message}`);
      continue;
    }
    rec.check(`audit_release ${tag} was accepted by consensus`, true);

    const release = await v("find_release", [ctx.pkg, c.version]);
    ctx.releases[c.version] = release;
    const audit = await v("get_audit", [release.latest_audit_id]);
    const notes = await v("get_audit_notes", [release.latest_audit_id]);
    console.log(
      `     verdict ${audit.verdict}, severity ${audit.severity}, declared ${audit.declared_bump}, honest bump ${audit.required_bump}, ${audit.item_count} entries`,
    );

    rec.eq(`${tag}: verdict`, audit.verdict, c.expect.verdict);
    rec.eq(`${tag}: severity`, audit.severity, c.expect.severity);
    rec.eq(`${tag}: declared bump`, audit.declared_bump, c.expect.declared);
    rec.eq(`${tag}: required bump`, audit.required_bump, c.expect.required);
    rec.eq(`${tag}: release record agrees with the audit`, [release.verdict, release.severity, release.declared_bump], [audit.verdict, audit.severity, audit.declared_bump]);
    rec.eq(`${tag}: release bookkeeping`, [release.version, release.previous_version, release.notes_url, release.audit_count, release.edit_count, release.check_count], [c.version, c.previous, NOTES, 1, 0, 0]);
    rec.check(`${tag}: the notes were read (entries found)`, audit.item_count >= 1, `item_count ${audit.item_count}`);
    if (c.expect.severity === "BREAKING") rec.check(`${tag}: at least one entry classified breaking`, audit.breaking_entries >= 1, `breaking_entries ${audit.breaking_entries}`);
    if (c.expect.severity === "FEATURE") rec.check(`${tag}: at least one entry classified feature`, audit.feature_entries >= 1, `feature_entries ${audit.feature_entries}`);

    const evidence = Array.isArray(audit.evidence) ? audit.evidence : [];
    rec.check(`${tag}: evidence is present (max 3 entries)`, evidence.length >= 1 && evidence.length <= 3, `${evidence.length} item(s)`);
    for (const needle of c.quote) {
      rec.check(`${tag}: evidence quotes "${needle}"`, evidence.some((e) => String(e.t).includes(needle)), JSON.stringify(evidence.map((e) => e.t)));
    }
    rec.check(`${tag}: every evidence quote is verbatim in the stored release section`, evidence.every((e) => notes.block.includes(e.t)), JSON.stringify(evidence.map((e) => e.t)));

    rec.check(`${tag}: block hash is a Keccak-256 hex digest`, HASH_RE.test(audit.block_hash), String(audit.block_hash));
    rec.eq(`${tag}: block hash is recorded on the release and in the notes view`, [release.first_block_hash, release.latest_block_hash, notes.block_hash], [audit.block_hash, audit.block_hash, audit.block_hash]);
    rec.check(`${tag}: stored section is this release's section only`, notes.block.includes(c.quote[0]) && c.mustNotContain.every((x) => !notes.block.includes(x)), `block of ${notes.block.length} chars`);
    rec.check(`${tag}: no prompt-injection warning on clean notes`, audit.injection_flagged === false);

    if (c.expect.verdict === "COMPLIANT") counted.compliant++;
    if (c.expect.verdict === "UNDER_BUMPED") counted.under++;
    const pkg = await v("get_package", [ctx.pkg]);
    rec.eq(`${tag}: package counters after this audit`, [pkg.releases, pkg.compliant, pkg.under_bumped], [Object.keys(ctx.releases).length, counted.compliant, counted.under]);
  }

  const audited = Object.keys(ctx.releases).length;
  const pkg = await v("get_package", [ctx.pkg]);
  if (audited === CASES.length) {
    rec.eq("integrity_permille is 666 (2 of 3 releases told the truth)", pkg.integrity_permille, 666);
    rec.eq("package totals: 3 releases, 2 compliant, 1 under-bumped, 0 over-bumped", [pkg.releases, pkg.compliant, pkg.under_bumped, pkg.over_bumped], [3, 2, 1, 0]);
  } else {
    rec.check("all three audits completed, so integrity can be judged", false, `${audited} of ${CASES.length} audits completed`);
  }
  const stats = await v("get_stats");
  const base = ctx.baseline;
  rec.eq("get_stats deltas: +3 releases, +3 audits, +2 compliant, +1 under-bumped", [stats.releases - base.releases, stats.audits - base.audits, stats.compliant - base.compliant, stats.under_bumped - base.under_bumped], [audited, audited, counted.compliant, counted.under]);
  if (deployed) rec.eq("global integrity_permille on a fresh contract is 666", stats.integrity_permille, 666);
}

// ---------------------------------------------------------------------------------------------
// 4. re-audit, cooldown, paging
// ---------------------------------------------------------------------------------------------
async function reaudit() {
  const newest = ctx.releases["2.0.0"] ?? ctx.releases["1.5.0"] ?? ctx.releases["1.4.3"];
  if (!newest) throw new Error("no audited release to re-audit");
  const cooldown = ctx.limits?.min_reaudit_interval_seconds ?? 300;

  // Run this first: the cooldown clock started when the release was audited.
  const statsBefore = await v("get_stats");
  const label = `reaudit_release #${newest.id} straight after its audit`;
  let outcome;
  try {
    const out = await send(client, address, "reaudit_release", [newest.id], quiet);
    rec.tx(label, out.hash);
    outcome = { ok: true };
  } catch (err) {
    rec.tx(label, err.hash);
    outcome = { ok: false, err };
  }
  if (!outcome.ok) {
    rec.reverted(`${label} is refused (cooldown ${cooldown}s)`, outcome.err, "cooldown still active");
    const after = await v("get_release", [newest.id]);
    rec.eq("refused re-audit changed nothing on the release", [after.check_count, after.audit_count, after.last_checked_at], [newest.check_count, newest.audit_count, newest.last_checked_at]);
    rec.eq("refused re-audit changed no global counter", await v("get_stats"), statsBefore);
  } else {
    const waited = Date.now() / 1000 - newest.last_checked_at;
    if (waited >= cooldown - 5) {
      // The three consensus rounds took longer than the cooldown, so the call was legitimately allowed. Verify that path instead.
      rec.note(`the audits took ${Math.round(waited)}s, longer than the ${cooldown}s cooldown: the re-audit was legitimately allowed, so the "unchanged notes" path is verified instead`);
      const after = await v("get_release", [newest.id]);
      rec.eq("unchanged notes: only the check counter moved", [after.check_count, after.audit_count, after.edit_count, after.latest_audit_id], [newest.check_count + 1, newest.audit_count, newest.edit_count, newest.latest_audit_id]);
      const stats = await v("get_stats");
      rec.eq("unchanged notes: rechecks +1, audits unchanged", [stats.rechecks, stats.audits], [statsBefore.rechecks + 1, statsBefore.audits]);
    } else {
      rec.check(`${label} is refused (cooldown ${cooldown}s)`, false, `it was ACCEPTED only ~${Math.round(waited)}s after the audit`);
    }
  }

  await mustRevert("reaudit_release of an unknown release id", "reaudit_release", [MISSING_ID], "release not found");
  const known = Object.values(ctx.releases)[0];
  await mustRevert(`audit_release of ${known.version} again points to reaudit_release`, "audit_release", [ctx.pkg, known.version, known.previous_version, NOTES], `already audited as release #${known.id}`);

  // ---- history views and pagination --------------------------------------------------
  const ids = Object.values(ctx.releases).map((r) => r.id).sort((a, b) => a - b);
  for (const rel of Object.values(ctx.releases)) {
    const all = await v("list_release_audits", [rel.id, 0, 50]);
    rec.eq(`list_release_audits(#${rel.id}): one recorded audit`, [all.total, all.items.length], [1, 1]);
    rec.eq(`list_release_audits(#${rel.id}): it is the latest audit`, all.items[0]?.id, rel.latest_audit_id);
    const past = await v("list_release_audits", [rel.id, 1, 10]);
    rec.eq(`list_release_audits(#${rel.id}): offset past the end is empty`, [past.total, past.items.length, past.offset], [1, 0, 1]);
    const none = await v("list_release_audits", [rel.id, 0, 0]);
    rec.eq(`list_release_audits(#${rel.id}): limit 0 returns no items`, [none.total, none.items.length], [1, 0]);
  }
  await viewMustFail("list_release_audits of an unknown release is refused", "list_release_audits", [MISSING_ID, 0, 10], "release not found");

  if (ids.length >= 2) {
    const full = await v("list_package_releases", [ctx.pkg, 0, 50]);
    rec.eq("list_package_releases: total and order (by audit order)", [full.total, full.items.map((r) => r.id)], [ids.length, ids]);
    const p1 = await v("list_package_releases", [ctx.pkg, 0, 2]);
    rec.eq("list_package_releases page 1 (offset 0, limit 2)", [p1.total, p1.offset, p1.items.map((r) => r.id)], [ids.length, 0, ids.slice(0, 2)]);
    const p2 = await v("list_package_releases", [ctx.pkg, 2, 2]);
    rec.eq("list_package_releases page 2 (offset 2, limit 2)", [p2.total, p2.offset, p2.items.map((r) => r.id)], [ids.length, 2, ids.slice(2, 4)]);
    const p3 = await v("list_package_releases", [ctx.pkg, 50, 2]);
    rec.eq("list_package_releases offset beyond the end is clamped and empty", [p3.total, p3.offset, p3.items.length], [ids.length, ids.length, 0]);
    const walked = [];
    for (let offset = 0; offset < ids.length; offset++) walked.push(...(await v("list_package_releases", [ctx.pkg, offset, 1])).items.map((r) => r.id));
    rec.eq("walking one release per page visits each release exactly once", walked, ids);
  } else {
    rec.check("enough releases exist to test pagination", false, `${ids.length} release(s) audited`);
  }

  const onePackage = await v("list_packages", [ctx.pkg - 1, 1]);
  rec.eq("list_packages(offset, limit 1) returns exactly the base package", onePackage.items.map((p) => p.id), [ctx.pkg]);
  const mine = await v("list_registrant_packages", [account.address]);
  const expectedMine = [ctx.pkg, ctx.pkgMirror, ctx.pkgOther, ctx.pkgBoundary];
  if (process.env.BA_PRIVATE_KEY) rec.check("list_registrant_packages includes the four packages from this run", expectedMine.every((x) => mine.items.some((p) => p.id === x)), JSON.stringify(mine.items.map((p) => p.id)));
  else rec.eq("list_registrant_packages: exactly the four packages from this run", mine.items.map((p) => p.id), expectedMine);
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------
console.log(`BumpAudit live E2E on Studionet${QUICK ? "  (QUICK sample)" : ""}`);
console.log(`fixture  ${NOTES}`);
try {
  await rec.scenario("0. Preflight", preflight);
  if (address) {
    await rec.scenario("1. Basics and registration", basics);
    await rec.scenario("2. Adversarial input validation", adversarial);
    await rec.scenario("3. Live AI consensus and semantic auditing", audits);
    await rec.scenario("4. Re-audit, cooldown and history paging", reaudit);
  }
} finally {
  const ok = rec.finish();
  const report = rec.toJSON({ contract: address || null, account: account.address, network: "GenLayer Studionet", fixtureBase: BASE, packageName: NAME, quick: QUICK, node: process.version });
  try {
    const files = writeReports(REPORT_DIR, report, { explorer: EXPLORER });
    console.log(`\nreports:\n  ${files.html}\n  ${files.md}\n  ${files.json}\n  ${files.summary}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, readFileSync(files.summary, "utf8"));
    }
  } catch (err) {
    console.error(`could not write the reports: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
  if (!ok) process.exitCode = 1;
}
