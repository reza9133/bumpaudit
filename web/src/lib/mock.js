// Demo data for UI development without a network: `VITE_DEMO=1 npm run dev`.
// This module is never included in a normal production build.
import { keccak256, stringToBytes } from "viem";
import { parseSemver, declaredBump } from "./semver.js";

const ME = "0x1111111111111111111111111111111111111111";
const NOW = Math.floor(Date.now() / 1000);

const BLOCKS = {
  1: "## [1.4.3] - 2026-02-02\n- Removed the deprecated --legacy flag. Scripts that still pass it now fail.\n- Fixed a crash when the cache directory is read-only.",
  2: "## [1.5.0] - 2026-02-20\n- Added streaming uploads for large files.\n- Fixed a typo in the help output.",
  3: "## [2.0.0] - 2026-03-01\n- BREAKING CHANGE: removed the legacy connect() API. Use Client.open() instead.\n- Added a typed error hierarchy.",
  4: "## [0.3.1] - 2026-01-10\n- Fixed an off-by-one error in the tokenizer.",
  5: "## [2.0.0] - 2026-03-01\n- Removed the legacy connect() API. Use Client.open() instead.\n- Added a typed error hierarchy.",
};
const audits = [
  { id: 1, release_id: 1, severity: "BREAKING", required_bump: "MAJOR", declared_bump: "PATCH", verdict: "UNDER_BUMPED", n: [2, 1, 0, 1, 0], evidence: [{ i: 0, t: "Removed the deprecated --legacy flag. Scripts that still pass it now fail." }] },
  { id: 2, release_id: 2, severity: "FEATURE", required_bump: "MINOR", declared_bump: "MINOR", verdict: "COMPLIANT", n: [2, 0, 1, 1, 0], evidence: [{ i: 0, t: "Added streaming uploads for large files." }] },
  { id: 3, release_id: 3, severity: "BREAKING", required_bump: "MAJOR", declared_bump: "MAJOR", verdict: "COMPLIANT", n: [2, 1, 1, 0, 1], evidence: [{ i: 0, t: "BREAKING CHANGE: removed the legacy connect() API. Use Client.open() instead." }] },
  { id: 4, release_id: 4, severity: "FIX", required_bump: "PATCH", declared_bump: "PATCH", verdict: "COMPLIANT", n: [1, 0, 0, 1, 0], evidence: [] },
  { id: 5, release_id: 3, severity: "BREAKING", required_bump: "MAJOR", declared_bump: "MAJOR", verdict: "COMPLIANT", n: [2, 1, 1, 0, 0], evidence: [{ i: 0, t: "Removed the legacy connect() API. Use Client.open() instead." }], changed: true },
];

const releasesBase = [
  { id: 1, package_id: 1, version: "1.4.3", previous_version: "1.4.2", declared_bump: "PATCH", verdict: "UNDER_BUMPED", severity: "BREAKING", audits: [1] },
  { id: 2, package_id: 1, version: "1.5.0", previous_version: "1.4.3", declared_bump: "MINOR", verdict: "COMPLIANT", severity: "FEATURE", audits: [2] },
  { id: 3, package_id: 1, version: "2.0.0", previous_version: "1.5.0", declared_bump: "MAJOR", verdict: "COMPLIANT", severity: "BREAKING", audits: [3, 5], edit_count: 1 },
  { id: 4, package_id: 2, version: "0.3.1", previous_version: "0.3.0", declared_bump: "PATCH", verdict: "COMPLIANT", severity: "FIX", audits: [4], initial: true },
];

const hashes = {};
for (const k of Object.keys(BLOCKS)) hashes[k] = keccak256(stringToBytes(BLOCKS[k])).slice(2);

function auditDict(a) {
  return {
    id: a.id, release_id: a.release_id, requester: ME, block_hash: hashes[a.id], block_len: BLOCKS[a.id].length,
    item_count: a.n[0], breaking_entries: a.n[1], feature_entries: a.n[2], fix_entries: a.n[3], explicit_markers: a.n[4],
    severity: a.severity, required_bump: a.required_bump, declared_bump: a.declared_bump, verdict: a.verdict, evidence: a.evidence,
    injection_flagged: false, notes_changed: !!a.changed, softened: false, created_at: NOW - 86400 * (7 - a.id),
  };
}
function releaseDict(r) {
  const first = r.audits[0];
  const last = r.audits[r.audits.length - 1];
  return {
    id: r.id, package_id: r.package_id, version: r.version, previous_version: r.previous_version, declared_bump: r.declared_bump,
    initial_development: !!r.initial, prerelease: false, notes_url: `https://github.com/acme/widget/releases/tag/v${r.version}`,
    verdict: r.verdict, severity: r.severity, audit_count: r.audits.length, edit_count: r.edit_count || 0, verdict_changes: 0, softened: false,
    first_audit_id: first, latest_audit_id: last, first_block_hash: hashes[first], latest_block_hash: hashes[last],
    created_at: NOW - 86400 * 6, last_checked_at: NOW - 600, check_count: 2,
  };
}
function packageDict(p) {
  const rels = releasesBase.filter((r) => r.package_id === p.id);
  const c = (v) => rels.filter((r) => r.verdict === v).length;
  const honest = c("COMPLIANT") + c("OVER_BUMPED");
  const judged = honest + c("UNDER_BUMPED");
  return {
    id: p.id, registrant: ME, name: p.name, ecosystem: p.ecosystem, source_prefix: p.prefix, created_at: NOW - 86400 * 9,
    releases: rels.length, compliant: c("COMPLIANT"), under_bumped: c("UNDER_BUMPED"), over_bumped: c("OVER_BUMPED"), exempt: c("EXEMPT"),
    edited: rels.filter((r) => r.edit_count).length, softened: 0, judged, integrity_permille: judged ? Math.floor((honest * 1000) / judged) : null,
    last_audit_at: rels.length ? NOW - 3600 : 0,
  };
}
const PACKAGES = [
  { id: 1, name: "acme-widget", ecosystem: "npm", prefix: "https://github.com/acme/widget/releases/" },
  { id: 2, name: "snek-utils", ecosystem: "pypi", prefix: "https://github.com/snek/utils/releases/" },
  { id: 3, name: "zeta-cli", ecosystem: "cargo", prefix: "https://zeta.dev/changelog/" },
];
const page = (items, offset, limit, total = items.length) => ({ total, offset, items: items.slice(offset, offset + limit) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = (m) => { throw new Error("[EXPECTED] " + m); };

export async function mockView(fn, args) {
  await sleep(180);
  switch (fn) {
    case "get_version": return "demo";
    case "get_limits": return { version: "demo", ecosystems: ["npm", "pypi", "cargo"], max_name_chars: 80, max_url_chars: 500, max_version_chars: 64, max_block_chars: 6000, max_block_lines: 200, max_items: 60, max_item_chars: 300, max_evidence_items: 3, min_block_similarity_pct: 60, max_preview_chars: 60000, max_packages_per_registrant: 20, max_releases_per_package: 60, max_audits_per_address: 60, max_audits_per_release: 30, min_reaudit_interval_seconds: 300, max_page_size: 50 };
    case "get_stats": {
      const c = (v) => releasesBase.filter((r) => r.verdict === v).length;
      const honest = c("COMPLIANT") + c("OVER_BUMPED");
      return { version: "demo", packages: 3, releases: 4, audits: 5, compliant: c("COMPLIANT"), under_bumped: c("UNDER_BUMPED"), over_bumped: 0, exempt: 0, edited_releases: 1, softened_releases: 0, rechecks: 2, integrity_permille: Math.floor((honest * 1000) / (honest + c("UNDER_BUMPED"))) };
    }
    case "get_package": return packageDict(PACKAGES.find((p) => p.id === args[0]) || bad("package not found"));
    case "list_packages": return page(PACKAGES.map(packageDict), args[0], args[1]);
    case "find_packages": return page(PACKAGES.filter((p) => p.ecosystem === args[0] && p.name === args[1]).map(packageDict), 0, 50);
    case "list_registrant_packages": return page(PACKAGES.slice(0, 2).map(packageDict), 0, 50);
    case "list_package_releases": return page(releasesBase.filter((r) => r.package_id === args[0]).map(releaseDict), args[1], args[2]);
    case "get_release": return releaseDict(releasesBase.find((r) => r.id === args[0]) || bad("release not found"));
    case "find_release": return releaseDict(releasesBase.find((r) => r.package_id === args[0] && r.version === args[1]) || bad("release not found"));
    case "list_release_audits": return page(releasesBase.find((r) => r.id === args[0])?.audits.map((id) => auditDict(audits.find((a) => a.id === id))) || [], args[1], args[2]);
    case "get_audit": return auditDict(audits.find((a) => a.id === args[0]) || bad("audit not found"));
    case "get_audit_notes": return { audit_id: args[0], block_hash: hashes[args[0]], block: BLOCKS[args[0]], items: BLOCKS[args[0]].split("\n").slice(1).map((l) => l.replace(/^- /, "")) };
    case "describe_version": {
      const p = parseSemver(args[0]);
      return p ? { valid: true, major: p.major, minor: p.minor, patch: p.patch, prerelease: p.pre, build: p.build, normalized: `${p.core.join(".")}${p.pre ? "-" + p.pre : ""}` } : { valid: false };
    }
    case "preview_verdict": {
      const a = parseSemver(args[0]); const b = parseSemver(args[1]);
      if (!a || !b) bad("both versions must be valid SemVer 2.0.0");
      const declared = declaredBump(a, b) || bad("version must be higher than previous_version");
      const need = { BREAKING: a.major === 0 ? "MINOR" : "MAJOR", FEATURE: a.major === 0 ? "PATCH" : "MINOR", FIX: "PATCH" }[args[2]];
      const rank = { PATCH: 0, MINOR: 1, MAJOR: 2 };
      return { declared_bump: declared, required_bump: need, initial_development: a.major === 0, prerelease: !!b.pre, verdict: b.pre ? "EXEMPT" : rank[declared] < rank[need] ? "UNDER_BUMPED" : rank[declared] > rank[need] && a.major !== 0 ? "OVER_BUMPED" : "COMPLIANT" };
    }
    case "check_source_url": return { valid: /^https:\/\/[^/]+\/.+/.test(args[0]), canonical: args[0].replace(/#.*$/, "") };
    case "preview_extraction": {
      const lines = String(args[0]).split("\n");
      const at = lines.findIndex((l) => /^#{1,4}\s/.test(l) && l.includes(args[1]));
      if (at < 0) return { version: args[1], found: false, reason: "not_found", block: "", items: [] };
      let end = lines.length;
      for (let i = at + 1; i < lines.length; i++) if (/^#{1,4}\s/.test(lines[i])) { end = i; break; }
      const block = lines.slice(at, end).join("\n").trim();
      const items = lines.slice(at + 1, end).filter((l) => /^\s*[-*]\s/.test(l)).map((l, i) => ({ index: i, text: l.replace(/^\s*[-*]\s+/, ""), explicit_breaking: /BREAKING/.test(l) }));
      return { version: args[1], found: true, reason: "", block, items };
    }
    default: throw new Error("mock: unknown view " + fn);
  }
}

export async function mockRpc(method) {
  await sleep(120);
  if (method === "eth_getBalance") return "0x" + (5n * 10n ** 18n).toString(16);
  return null;
}
