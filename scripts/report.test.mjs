import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { judgeRevert, Recorder, renderHtml, renderMarkdown, writeReports } from "./report.mjs";

const silent = () => {};
const tagged = (message, tag = "EXPECTED") => Object.assign(new Error(message), { tag });

test("judgeRevert accepts only an [EXPECTED] revert with the wanted reason", () => {
  assert.equal(judgeRevert(tagged("name must be 1-80 characters"), "name must be").pass, true);
  assert.equal(judgeRevert(tagged("NAME MUST BE x"), "name must be").pass, true, "case-insensitive substring");
  assert.equal(judgeRevert(tagged("name must be x"), /^name/).pass, true, "regular expressions work too");
  assert.equal(judgeRevert(tagged("something else"), "name must be").pass, false, "wrong reason");
  assert.equal(judgeRevert(tagged("name must be x", "EXTERNAL"), "name must be").pass, false, "wrong tag");
  assert.equal(judgeRevert(new Error("socket hang up"), "name must be").pass, false, "infrastructure failure");
  assert.equal(judgeRevert(null, "name must be").pass, false, "accepted transaction");
  assert.match(judgeRevert(null, "x").detail, /ACCEPTED/);
});

test("Recorder keeps the tally, marks scenarios and survives a crashing scenario", async () => {
  const lines = [];
  const rec = new Recorder({ log: (l) => lines.push(l) });
  await rec.scenario("good", async () => {
    rec.check("one", true);
    rec.eq("two", { a: [1] }, { a: [1] });
    rec.reverted("three", tagged("package not found"), "package not found");
  });
  await rec.scenario("bad", async () => {
    rec.check("four", false, "because");
    rec.eq("five", 1, 2);
  });
  await rec.scenario("crash", async () => {
    throw new Error("boom");
  });
  assert.deepEqual(rec.totals(), { total: 6, passed: 3, failed: 3, scenarios: 3, failedScenarios: 2 });
  assert.equal(rec.tallyLine(), "3 of 6 checks passed, 3 failed");
  assert.deepEqual(rec.scenarios.map((s) => s.status), ["PASS", "FAIL", "FAIL"]);
  assert.equal(rec.finish(), false);
  const text = lines.join("\n");
  assert.match(text, /^ {2}ok {2}one$/m);
  assert.match(text, /^ {2}no {2}four$/m);
  assert.match(text, /-> because/);
  assert.match(text, /^PASS {2}good/m);
  assert.match(text, /^FAIL {2}bad/m);
  assert.match(text, /scenario aborted: boom/);
  assert.match(text, /^FAIL {2}3 of 6 checks passed, 3 failed/m);
});

test("an all-green run says 0 failed and finish() is true; an empty run is not a pass", async () => {
  const rec = new Recorder({ log: silent });
  assert.equal(rec.finish(), false);
  await rec.scenario("s", async () => rec.check("x", true));
  assert.equal(rec.tallyLine(), "1 of 1 checks passed, 0 failed");
  assert.equal(rec.finish(), true);
  assert.equal(rec.toJSON().result, "PASS");
});

test("reports are written, escape hostile text and carry the tally", async () => {
  const rec = new Recorder({ log: silent });
  await rec.scenario("<b>title</b>", async () => {
    rec.check('label with <script>alert("x")</script>', false, "detail | with pipe & <tag>");
    rec.note("a note");
    rec.tx("deploy", "0x" + "ab".repeat(32));
  });
  const report = rec.toJSON({ contract: "0x" + "12".repeat(20), durationMs: 5 });
  const html = renderHtml(report, "https://explorer.example");
  assert.ok(!html.includes("<script>alert"), "script tag must be escaped");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("0 of 1 checks passed, 1 failed") || html.includes("0 of 1 checks passed"));
  assert.ok(html.includes("prefers-color-scheme:dark"));
  const md = renderMarkdown(report, "https://explorer.example");
  assert.ok(md.includes("detail \\| with pipe"), "pipes are escaped for tables");
  assert.ok(md.includes("https://explorer.example/tx/0x"));

  const dir = mkdtempSync(join(tmpdir(), "ba-report-"));
  const files = writeReports(dir, report, { stamp: "T" });
  assert.deepEqual(readdirSync(dir).sort(), ["bumpaudit-e2e-T.html", "bumpaudit-e2e-T.json", "bumpaudit-e2e-T.md", "bumpaudit-e2e-summary.md"]);
  assert.equal(JSON.parse(readFileSync(files.json, "utf8")).totals.failed, 1);
  const summary = readFileSync(files.summary, "utf8");
  assert.match(summary, /\*\*FAIL\*\*: 0 of 1 checks passed, 1 failed/);
  assert.match(summary, /Failures:/);
});
