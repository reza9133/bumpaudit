// Light client-side mirror of the contract's SemVer parsing, used only for instant form feedback.
// The contract stays the authority: every value is re-checked on-chain.
const NUM = "(0|[1-9]\\d*)";
const PRE_ID = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const RE = new RegExp(`^v?${NUM}\\.${NUM}\\.${NUM}(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`);

export function parseSemver(input) {
  const m = RE.exec(String(input || "").trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || "", build: m[5] || "", core: [+m[1], +m[2], +m[3]] };
}

export function declaredBump(prev, next) {
  const a = prev.core;
  const b = next.core;
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return ["MAJOR", "MINOR", "PATCH"][i];
    if (b[i] < a[i]) return null;
  }
  return null;
}

export function inspectBump(previous, version) {
  const prev = parseSemver(previous);
  const next = parseSemver(version);
  if (!previous && !version) return { state: "empty" };
  if (!prev) return { state: "error", message: "Previous version is not valid SemVer 2.0.0 (example: 1.4.2)." };
  if (prev.pre) return { state: "error", message: "The previous version must be a stable release (no pre-release tag)." };
  if (!next) return { state: "error", message: "Version is not valid SemVer 2.0.0 (example: 1.4.3 or v2.0.0-rc.1)." };
  const bump = declaredBump(prev, next);
  if (!bump) return { state: "error", message: "The version must be higher than the previous version." };
  return { state: "ok", bump, prerelease: !!next.pre, initialDevelopment: prev.major === 0, prev, next };
}
