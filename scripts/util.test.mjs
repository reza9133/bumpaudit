import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAudit, findAddress, normalize, parseArgs, receiptFailed, taggedMessage } from "./util.mjs";

test("normalize turns Maps, BigInts and 20-byte arrays into plain values", () => {
  const input = new Map([["id", 7n], ["owner", new Uint8Array(20).fill(0xab)], ["big", 2n ** 70n], ["list", [new Map([["x", 1n]])]]]);
  assert.deepEqual(normalize(input), {
    id: 7, owner: "0x" + "ab".repeat(20), big: (2n ** 70n).toString(), list: [{ x: 1 }],
  });
  assert.equal(normalize(null), null);
  assert.deepEqual(normalize(new Uint8Array([1, 2, 3])), [1, 2, 3]);
});

test("normalize stops on absurdly deep structures", () => {
  let deep = {};
  for (let i = 0; i < 30; i++) deep = { deep };
  assert.ok(JSON.stringify(normalize(deep)).includes("null"));
});

test("taggedMessage finds the contract's own error text anywhere in a receipt", () => {
  assert.equal(taggedMessage({ a: [{ b: 'VM error: "[EXPECTED] this version is already audited as release #1; use reaudit_release"' }] }),
    "this version is already audited as release #1; use reaudit_release");
  assert.equal(taggedMessage("x [EXTERNAL] notes_url could not be fetched\\n more"), "notes_url could not be fetched");
  assert.equal(taggedMessage({ nothing: ["to see"] }), null);
  assert.equal(taggedMessage(null), null);
});

test("findAddress prefers well-known keys and finds nested addresses", () => {
  const address = "0x" + "12".repeat(20);
  assert.equal(findAddress({ data: { contract_address: address } }), address);
  assert.equal(findAddress({ deep: [{ x: "nope" }, { y: address }] }), address);
  assert.equal(findAddress({ short: "0x1234" }), null);
});

test("receiptFailed", () => {
  assert.equal(receiptFailed({ txExecutionResultName: "FINISHED_WITH_ERROR" }), true);
  assert.equal(receiptFailed({ txExecutionResultName: "FINISHED_WITH_RETURN" }), false);
  assert.equal(receiptFailed(undefined), false);
});

test("parseArgs", () => {
  const { flags, values } = parseArgs(["--quick", "--base", "https://x/y", "positional", "--verbose"]);
  assert.deepEqual([...flags].sort(), ["quick", "verbose"]);
  assert.equal(values.get("base"), "https://x/y");
});

test("describeAudit prints verdict, evidence and warnings", () => {
  const text = describeAudit({
    verdict: "UNDER_BUMPED", severity: "BREAKING", declared_bump: "PATCH", required_bump: "MAJOR", item_count: 4,
    breaking_entries: 1, feature_entries: 0, fix_entries: 1, explicit_markers: 1, block_hash: "ab", injection_flagged: true,
    notes_changed: true, softened: true, evidence: [{ i: 2, t: "BREAKING CHANGE: x" }],
  });
  for (const part of ["UNDER_BUMPED", "declared bump PATCH", "#2 \"BREAKING CHANGE: x\"", "tries to address", "EDITED", "SOFTENED"]) {
    assert.ok(text.includes(part), part);
  }
});
