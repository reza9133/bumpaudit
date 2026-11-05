#!/usr/bin/env node
/**
 * Live walk-through on Studionet: registers a package, audits three releases of the
 * fixture changelog in examples/fixtures/CHANGELOG.md and prints what validators decided.
 *
 *   npm run demo -- --base https://raw.githubusercontent.com/<you>/<repo>/main/examples/fixtures
 *
 * The page must be publicly reachable, so push examples/fixtures/ to a repository of yours
 * first (or point --base at any folder that serves CHANGELOG.md).
 *
 * Environment / flags:
 *   BA_CONTRACT_ADDRESS   reuse a deployment (otherwise one is deployed)
 *   BA_PRIVATE_KEY        key for the acting account (otherwise generated and funded)
 *   --base <url>          folder URL serving CHANGELOG.md (no trailing slash needed)
 *   --preview-only        only run the free, instant dry-run parser on the local fixture
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAccount, deployContract, EXPLORER, fund, generatePrivateKey, makeClient, ROOT, send, view } from "./lib.mjs";
import { describeAudit, parseArgs } from "./util.mjs";

const { flags, values } = parseArgs(process.argv.slice(2));
const base = (values.get("base") || process.env.BA_FIXTURE_BASE || "").replace(/\/$/, "");
const fixture = readFileSync(resolve(ROOT, "examples", "fixtures", "CHANGELOG.md"), "utf8");

const key = process.env.BA_PRIVATE_KEY || generatePrivateKey();
const account = createAccount(key);
const client = makeClient(account);
console.log(`account ${account.address}`);
const funded = await fund(client, account.address);
if (funded !== true) console.log(`  (funding note: ${funded})`);

let address = process.env.BA_CONTRACT_ADDRESS;
if (!address) {
  ({ address } = await deployContract(client));
  console.log(`  contract ${address}  ${EXPLORER}/contracts/${address}`);
}

console.log("\n1. dry run: what would validators extract from the local fixture? (free, instant, no network)");
const preview = await view(client, address, "preview_extraction", [fixture, "1.4.3"]);
console.log(`  found=${preview.found}; ${preview.items.length} entries:`);
for (const item of preview.items) console.log(`   ${String(item.index + 1).padStart(2)}. ${item.explicit_breaking ? "[explicit marker] " : ""}${item.text}`);
if (flags.has("preview-only")) process.exit(0);
if (!base) {
  console.error("\nPass --base <folder url serving CHANGELOG.md> (or BA_FIXTURE_BASE) to run the live audits.");
  process.exit(2);
}

console.log("\n2. register the package; audits must cite a page below this prefix");
try {
  await send(client, address, "register_package", ["acme-widget", "npm", base + "/"]);
} catch (err) {
  if (!/already registered/.test(err.message)) throw err;
  console.log("  (already registered on this contract; reusing it)");
}
const found = await view(client, address, "find_packages", ["npm", "acme-widget", 0, 50]);
const pkg = found.items.find((p) => p.source_prefix === base + "/");
if (!pkg) throw new Error(`no package with source prefix ${base}/ found`);
console.log(`  package #${pkg.id}  prefix ${pkg.source_prefix}`);

const url = `${base}/CHANGELOG.md`;
const plan = [
  ["1.4.3", "1.4.2", "a PATCH release that quietly removes a flag: expect UNDER_BUMPED"],
  ["1.5.0", "1.4.3", "a MINOR release that adds a feature: expect COMPLIANT"],
  ["2.0.0", "1.5.0", "a MAJOR release that removes an API: expect COMPLIANT"],
];
let step = 3;
for (const [version, previous, note] of plan) {
  console.log(`\n${step++}. audit ${previous} -> ${version}  (${note})`);
  try {
    await send(client, address, "audit_release", [pkg.id, version, previous, url]);
    const release = await view(client, address, "find_release", [pkg.id, version]);
    console.log(describeAudit(await view(client, address, "get_audit", [release.latest_audit_id])));
  } catch (err) {
    console.log(`  reverted: ${err.message}`);
  }
}

console.log("\nresult");
const finalPackage = await view(client, address, "get_package", [pkg.id]);
console.log(`  ${finalPackage.name}: ${finalPackage.compliant} compliant, ${finalPackage.under_bumped} under-bumped, ${finalPackage.over_bumped} over-bumped; integrity ${finalPackage.integrity_permille ?? "n/a"} / 1000`);
console.log(`  ${EXPLORER}/contracts/${address}`);
console.log(`\nNext: wait 5 minutes, edit CHANGELOG.md in your repository (for example delete the "Removed" line of 2.0.0) and call reaudit_release to watch edit detection.`);
