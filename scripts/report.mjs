// Check recorder and report writers for scripts/e2e.mjs. No network and no genlayer-js
// import on purpose, so everything here is unit-tested offline (scripts/report.test.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const clip = (value, max = 400) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
};

/**
 * Decides whether a thrown error is the kind of revert the test wanted.
 * Pass = the contract itself rejected the call with an [EXPECTED] tag and the message contains `needle`.
 * Anything else (transport failure, an [EXTERNAL] error, a different message) is a failure with an explanation.
 */
export function judgeRevert(err, needle) {
  if (err == null) return { pass: false, detail: "the transaction was ACCEPTED but had to revert" };
  const message = String(err.message ?? err);
  const tag = err.tag ?? null;
  const wanted = needle instanceof RegExp ? needle.test(message) : message.toLowerCase().includes(String(needle).toLowerCase());
  if (tag === "EXPECTED" && wanted) return { pass: true, detail: `[EXPECTED] ${message}` };
  if (tag !== "EXPECTED") return { pass: false, detail: `reverted without an [EXPECTED] tag (tag=${tag ?? "none"}): ${clip(message)}` };
  return { pass: false, detail: `[EXPECTED] revert with the wrong reason: ${clip(message)} (wanted ${needle})` };
}

export class Recorder {
  constructor({ log = console.log, now = () => Date.now() } = {}) {
    this.log = log;
    this.now = now;
    this.scenarios = [];
    this.txs = [];
    this.current = null;
    this.startedAt = now();
  }

  tx(label, hash) {
    if (hash) this.txs.push({ label, hash, scenario: this.current?.title ?? null });
  }

  /** Runs one scenario. A thrown error is recorded as a failed check; later scenarios still run. */
  async scenario(title, fn) {
    const entry = { title, checks: [], notes: [], startedAt: this.now(), durationMs: 0, status: "PASS" };
    this.scenarios.push(entry);
    this.current = entry;
    this.log(`\n== ${title}`);
    try {
      await fn();
    } catch (err) {
      this.check(`scenario aborted: ${clip(String(err?.message ?? err), 300)}`, false);
    }
    entry.durationMs = this.now() - entry.startedAt;
    entry.status = entry.checks.some((c) => !c.pass) ? "FAIL" : "PASS";
    this.log(`${entry.status}  ${title}  (${entry.checks.filter((c) => c.pass).length}/${entry.checks.length} checks, ${(entry.durationMs / 1000).toFixed(1)}s)`);
    this.current = null;
    return entry;
  }

  check(label, pass, detail = "") {
    const ok = Boolean(pass);
    const target = this.current ?? this.#orphan();
    target.checks.push({ label, pass: ok, detail: detail === "" ? "" : clip(detail, 600) });
    this.log(`  ${ok ? "ok" : "no"}  ${label}${!ok && detail !== "" ? `\n        -> ${clip(detail, 600)}` : ""}`);
    return ok;
  }

  eq(label, actual, expected) {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    return this.check(label, same, same ? "" : `expected ${clip(expected, 200)}, got ${clip(actual ?? null, 200)}`);
  }

  /** Records the outcome of an attempted call that was supposed to revert. `err` is what it threw (or null). */
  reverted(label, err, needle) {
    const verdict = judgeRevert(err, needle);
    return this.check(label, verdict.pass, verdict.detail);
  }

  note(text) {
    (this.current ?? this.#orphan()).notes.push(text);
    this.log(`  ..  ${text}`);
  }

  #orphan() {
    let entry = this.scenarios.find((s) => s.title === "(outside a scenario)");
    if (!entry) {
      entry = { title: "(outside a scenario)", checks: [], notes: [], startedAt: this.now(), durationMs: 0, status: "PASS" };
      this.scenarios.push(entry);
    }
    return entry;
  }

  totals() {
    const checks = this.scenarios.flatMap((s) => s.checks);
    const passed = checks.filter((c) => c.pass).length;
    return { total: checks.length, passed, failed: checks.length - passed, scenarios: this.scenarios.length, failedScenarios: this.scenarios.filter((s) => s.checks.some((c) => !c.pass)).length };
  }

  tallyLine() {
    const t = this.totals();
    return `${t.passed} of ${t.total} checks passed, ${t.failed} failed`;
  }

  /** Terminal footer. */
  finish() {
    const t = this.totals();
    this.log(`\n${t.failed === 0 && t.total > 0 ? "PASS" : "FAIL"}  ${this.tallyLine()}  across ${t.scenarios} scenario(s)`);
    return t.failed === 0 && t.total > 0;
  }

  toJSON(meta = {}) {
    const finishedAt = this.now();
    return {
      meta: { ...meta, startedAt: new Date(this.startedAt).toISOString(), finishedAt: new Date(finishedAt).toISOString(), durationMs: finishedAt - this.startedAt },
      result: this.totals().failed === 0 && this.totals().total > 0 ? "PASS" : "FAIL",
      totals: this.totals(),
      tally: this.tallyLine(),
      scenarios: this.scenarios.map(({ title, status, durationMs, checks, notes }) => ({ title, status, durationMs, checks, notes })),
      transactions: this.txs,
    };
  }
}

const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function renderMarkdown(report, explorer = "") {
  const { meta, totals } = report;
  const out = [];
  out.push(`# BumpAudit live E2E report`, "");
  out.push(`**${report.result}** · ${report.tally} · ${totals.scenarios} scenario(s) · ${(meta.durationMs / 1000).toFixed(0)}s`, "");
  out.push(`| | |`, `|---|---|`);
  for (const [k, v] of Object.entries({ contract: meta.contract, account: meta.account, network: meta.network, "fixture base": meta.fixtureBase, "package name": meta.packageName, started: meta.startedAt, finished: meta.finishedAt })) {
    if (v) out.push(`| ${k} | ${cell(v)} |`);
  }
  out.push("");
  for (const s of report.scenarios) {
    out.push(`## ${s.status === "PASS" ? "✅" : "❌"} ${s.title}`, "");
    out.push(`${s.checks.filter((c) => c.pass).length}/${s.checks.length} checks · ${(s.durationMs / 1000).toFixed(1)}s`, "");
    out.push(`| | check | detail |`, `|---|---|---|`);
    for (const c of s.checks) out.push(`| ${c.pass ? "ok" : "**no**"} | ${cell(c.label)} | ${cell(c.detail)} |`);
    out.push("");
    for (const n of s.notes) out.push(`> ${cell(n)}`);
    if (s.notes.length) out.push("");
  }
  if (report.transactions.length) {
    out.push(`## Transactions`, "");
    for (const t of report.transactions) out.push(`- ${cell(t.label)}: ${explorer ? `[${t.hash}](${explorer}/tx/${t.hash})` : t.hash}`);
    out.push("");
  }
  return out.join("\n");
}

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderHtml(report, explorer = "") {
  const { meta, totals } = report;
  const rows = report.scenarios
    .map(
      (s) => `<section><h2><span class="pill ${s.status === "PASS" ? "pass" : "fail"}">${s.status}</span> ${esc(s.title)}</h2>
<p class="muted">${s.checks.filter((c) => c.pass).length}/${s.checks.length} checks · ${(s.durationMs / 1000).toFixed(1)}s</p>
<div class="scroll"><table><tbody>
${s.checks.map((c) => `<tr class="${c.pass ? "ok" : "no"}"><td class="mark">${c.pass ? "ok" : "no"}</td><td>${esc(c.label)}${c.detail ? `<div class="detail">${esc(c.detail)}</div>` : ""}</td></tr>`).join("\n")}
</tbody></table></div>
${s.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("\n")}</section>`,
    )
    .join("\n");
  const txs = report.transactions.length
    ? `<section><h2>Transactions</h2><ul>${report.transactions.map((t) => `<li>${esc(t.label)}: ${explorer ? `<a href="${esc(explorer)}/tx/${esc(t.hash)}">${esc(t.hash)}</a>` : esc(t.hash)}</li>`).join("")}</ul></section>`
    : "";
  const facts = Object.entries({ contract: meta.contract, account: meta.account, network: meta.network, "fixture base": meta.fixtureBase, "package name": meta.packageName, started: meta.startedAt, finished: meta.finishedAt })
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BumpAudit live E2E report · ${esc(report.result)}</title>
<style>
:root{--bg:#fff;--fg:#1c1f24;--muted:#5c6570;--line:#dde1e6;--ok:#15803d;--no:#b91c1c;--okbg:#e8f6ed;--nobg:#fdecec;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#14171a;--fg:#e6e9ec;--muted:#9aa4ae;--line:#2c3238;--ok:#4ade80;--no:#f87171;--okbg:#14291c;--nobg:#2e1717}}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:960px;margin-inline:auto}
h1{margin:0 0 4px}h2{font-size:1.05rem;margin:28px 0 4px}.muted{color:var(--muted);margin:0 0 8px}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:.8rem;font-weight:600}
.pill.pass{background:var(--okbg);color:var(--ok)}.pill.fail{background:var(--nobg);color:var(--no)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}td{padding:5px 8px;border-top:1px solid var(--line);vertical-align:top}
.mark{width:2.5em;font-family:ui-monospace,monospace;font-weight:600}tr.ok .mark{color:var(--ok)}tr.no{background:var(--nobg)}tr.no .mark{color:var(--no)}
.detail{color:var(--muted);font-size:.85rem;font-family:ui-monospace,monospace;word-break:break-word}.note{color:var(--muted);font-size:.9rem}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;font-size:.9rem}dt{color:var(--muted)}dd{margin:0;word-break:break-all}
</style></head><body>
<h1>BumpAudit live E2E report</h1>
<p><span class="pill ${report.result === "PASS" ? "pass" : "fail"}">${esc(report.result)}</span> ${esc(report.tally)} · ${totals.scenarios} scenario(s) · ${(meta.durationMs / 1000).toFixed(0)}s</p>
<dl>${facts}</dl>
${rows}
${txs}
</body></html>
`;
}

export function renderSummary(report, files = {}) {
  const lines = [`# BumpAudit E2E summary`, "", `**${report.result}**: ${report.tally}`, "", `Finished ${report.meta.finishedAt} against \`${report.meta.contract ?? "?"}\`.`, ""];
  for (const s of report.scenarios) lines.push(`- ${s.status === "PASS" ? "✅" : "❌"} ${s.title}: ${s.checks.filter((c) => c.pass).length}/${s.checks.length}`);
  const failing = report.scenarios.flatMap((s) => s.checks.filter((c) => !c.pass).map((c) => `${s.title}: ${c.label}${c.detail ? ` -> ${c.detail}` : ""}`));
  if (failing.length) lines.push("", "Failures:", ...failing.map((f) => `- ${f.replace(/\r?\n/g, " ")}`));
  if (files.html || files.md || files.json) lines.push("", `Full reports: ${[files.html, files.md, files.json].filter(Boolean).map((f) => `\`${f}\``).join(", ")}`);
  return lines.join("\n") + "\n";
}

/** Writes reports/bumpaudit-e2e-<timestamp>.{html,md,json} plus reports/bumpaudit-e2e-summary.md. Returns the paths. */
export function writeReports(dir, report, { explorer = "", stamp = new Date().toISOString().replace(/[:.]/g, "-") } = {}) {
  mkdirSync(dir, { recursive: true });
  const base = `bumpaudit-e2e-${stamp}`;
  const files = { html: join(dir, `${base}.html`), md: join(dir, `${base}.md`), json: join(dir, `${base}.json`), summary: join(dir, "bumpaudit-e2e-summary.md") };
  writeFileSync(files.json, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(files.md, renderMarkdown(report, explorer));
  writeFileSync(files.html, renderHtml(report, explorer));
  writeFileSync(files.summary, renderSummary(report, { html: `${base}.html`, md: `${base}.md`, json: `${base}.json` }));
  return files;
}
