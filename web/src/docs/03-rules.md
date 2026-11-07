title: The rules
group: Concepts
summary: How a verdict and the integrity score are derived.

## Verdict table

| Previous version | Release contains | Honest bump | Verdict if you shipped less | If you shipped more |
|---|---|---|---|---|
| `>= 1.0.0` | a breaking change | MAJOR | `UNDER_BUMPED` | `COMPLIANT` (exact) |
| `>= 1.0.0` | a new feature | MINOR | `UNDER_BUMPED` | `OVER_BUMPED` |
| `>= 1.0.0` | only fixes | PATCH | n/a | `OVER_BUMPED` |
| `0.y.z` (initial development) | a breaking change | MINOR | `UNDER_BUMPED` | `COMPLIANT` |
| `0.y.z` | a feature or a fix | PATCH | n/a | `COMPLIANT` (never "over") |

## The four verdicts

- **COMPLIANT.** The bump matches what changed.
- **UNDER_BUMPED.** The version number understates the change. This is the only verdict that lowers the integrity score.
- **OVER_BUMPED.** More cautious than needed. Harmless, and counted as honest.
- **EXEMPT.** Pre-releases such as `2.0.0-rc.1` are audited and stored but not scored.

## Details worth knowing

- The `0.y.z` row follows the convention of npm and Cargo (the MINOR number is the breaking boundary). Strict SemVer says "anything may change" there.
- `previous_version` must be a stable release lower than `version`. Build metadata (`+build.5`) and a leading `v` are ignored.
- The declared bump is the highest component that changed: `1.4.2 → 2.0.0` is MAJOR even if the minor number also moved.

## Integrity score

```
integrity = (COMPLIANT + OVER_BUMPED) * 1000 / (COMPLIANT + OVER_BUMPED + UNDER_BUMPED)
```

The contract stores it in permille (0 to 1000). The site shows it as a percentage and as a ring: green from 90%, amber from 60%, red below. A package with nothing judged yet shows **n/a**.

> [!WARN] A score only covers the releases somebody chose to audit. The ledger is permissionless, so anyone can audit a release, but nothing guarantees completeness. See [Security](#/docs/security).

Try any combination in the [Verdict calculator](#/tools?tool=rules). It is a free read call.
