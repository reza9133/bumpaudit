#!/usr/bin/env bash
# One command for everything: static checks -> local tests -> live Studionet E2E.
#
#   npm run test:all
#   SKIP_LOCAL=1 npm run test:all     skip the local pytest / JS suites (static checks and the live run still happen)
#   SKIP_LIVE=1  npm run test:all     everything except the live run (no network needed)
#   BA_E2E_QUICK=1 npm run test:all   smaller sample of the adversarial tables in the live run
#
# Settings are read from ./.env (BA_PRIVATE_KEY, BA_CONTRACT_ADDRESS, BA_FIXTURE_BASE, ...).
# A failure in the static checks or the local tests stops the run before the slow live part.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -t 1 ]; then BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'; else BOLD=""; GREEN=""; RED=""; DIM=""; RESET=""; fi
START=$SECONDS
STEPS=()

banner() { printf '\n%s== %s%s\n' "$BOLD" "$1" "$RESET"; }
pass()   { STEPS+=("PASS  $1"); printf '%sPASS%s  %s\n' "$GREEN" "$RESET" "$1"; }
fail()   { STEPS+=("FAIL  $1"); printf '%sFAIL%s  %s\n' "$RED" "$RESET" "$1"; summary 1; }
skip()   { STEPS+=("SKIP  $1"); printf '%sSKIP%s  %s\n' "$DIM" "$RESET" "$1"; }

summary() {
  printf '\n%s== summary%s  (%ss)\n' "$BOLD" "$RESET" "$((SECONDS - START))"
  printf '  %s\n' "${STEPS[@]}"
  exit "$1"
}

# run <label> <command...>: prints PASS/FAIL, aborts the whole script on failure
run() {
  local label="$1"; shift
  if "$@"; then pass "$label"; else fail "$label"; fi
}

# ---------------------------------------------------------------- static checks
banner "static checks"

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -ge 20 ]; then pass "node v$(node -p 'process.versions.node') (>= 20)"; else fail "node >= 20 required, found v$(node -p 'process.versions.node')"; fi

run "package.json is valid JSON with the test scripts" \
  node -e 'const p=JSON.parse(require("fs").readFileSync("package.json","utf8")); for (const k of ["test:live","test:all"]) if(!p.scripts[k]) throw new Error("missing script "+k)'

js_ok=1
for f in scripts/*.mjs; do node --check "$f" || js_ok=0; done
if [ "$js_ok" = 1 ]; then pass "node --check scripts/*.mjs"; else fail "node --check scripts/*.mjs"; fi

run "bash -n scripts/run-all.sh" bash -n scripts/run-all.sh

PY=$(command -v python3 || command -v python || true)
if [ -n "$PY" ]; then
  run "contracts/bump_audit.py compiles" "$PY" -c 'import ast,sys; ast.parse(open("contracts/bump_audit.py",encoding="utf8").read())'
else
  skip "python not found: contract syntax check"
fi

if [ -d node_modules/genlayer-js ]; then
  pass "genlayer-js is installed"
elif [ "${SKIP_LIVE:-0}" = 1 ]; then
  skip "genlayer-js is not installed (not needed with SKIP_LIVE=1)"
else
  printf '       run `npm install` first: the live run needs genlayer-js\n'
  fail "genlayer-js is not installed"
fi

if [ -f examples/fixtures/CHANGELOG.md ]; then pass "fixture examples/fixtures/CHANGELOG.md exists"; else fail "fixture examples/fixtures/CHANGELOG.md is missing"; fi

# ---------------------------------------------------------------- local tests
banner "local tests"
if [ "${SKIP_LOCAL:-0}" = 1 ]; then
  skip "local tests (SKIP_LOCAL=1)"
else
  run "unit tests of the script helpers (node --test)" npm run --silent test:js
  if [ -z "$PY" ]; then
    skip "python not found: contract tests"
  elif "$PY" -m pip show genlayer-test >/dev/null 2>&1 && "$PY" -m pytest --version >/dev/null 2>&1; then
    run "contract tests (pytest, genlayer-test direct mode)" "$PY" -m pytest -q
  else
    printf '%s       genlayer-test/pytest not installed: using the strict offline emulator (pip install -r requirements-dev.txt for the real harness)%s\n' "$DIM" "$RESET"
    run "contract tests (offline emulator)" "$PY" tools/offline_pytest/run.py -q -p offline_sim.plugin tests/contract
  fi
fi

# ---------------------------------------------------------------- live
banner "live end-to-end on Studionet"
if [ "${SKIP_LIVE:-0}" = 1 ]; then
  skip "live run (SKIP_LIVE=1)"
else
  if [ -n "${BA_CONTRACT_ADDRESS:-}" ]; then printf '  reusing contract %s\n' "$BA_CONTRACT_ADDRESS"; else printf '  no BA_CONTRACT_ADDRESS: a fresh contract will be deployed\n'; fi
  # Node 24 resolves IPv6 first and the Studionet RPC does not answer on it: force IPv4 first.
  run "scripts/e2e.mjs" node --dns-result-order=ipv4first scripts/e2e.mjs
  latest=$(ls -t reports/bumpaudit-e2e-summary.md 2>/dev/null | head -1 || true)
  [ -n "$latest" ] && printf '  reports in %s/reports/ (summary: %s)\n' "$PWD" "$latest"
fi

summary 0
