title: Contract API
group: Reference
summary: Every method the frontend calls, with parameters and return shapes.

All ids are `u256`. Views return plain JSON-friendly dicts. Pages are `{ total, offset, items }` and are capped at 50 items.

## Write methods

| Method | Description |
|---|---|
| `register_package(name, ecosystem, source_prefix)` | Registers a package. `source_prefix` is a public `https://` URL with a path. Several packages may share a name with different prefixes: a look-alike is a separate, clearly labelled entry. |
| `audit_release(package_id, version, previous_version, notes_url)` | Audits one release. Reverts with a tagged message if the page cannot be read, has no section for the version, or nothing in it can be classified. The URL is pinned to the release. |
| `reaudit_release(release_id)` | Re-reads the pinned URL (at most once every 5 minutes per release). Returns the audit that currently describes the notes. |

## Read methods

| Method | Used by |
|---|---|
| `get_version`, `get_limits`, `get_stats` | Home, Explorer, this page |
| `get_package(id)`, `list_packages(offset, limit)`, `find_packages(ecosystem, name, offset, limit)`, `list_registrant_packages(address)` | Explorer, package page, My packages |
| `get_release(id)`, `find_release(package_id, version)`, `list_package_releases(package_id, offset, limit)` | Package and release pages |
| `get_audit(id)`, `list_release_audits(release_id, offset, limit)`, `get_audit_notes(audit_id)` | Release page, hash verification |
| `describe_version`, `preview_verdict`, `check_source_url`, `preview_extraction` | Tools page and form validation |

## Record shapes

A **package** has `id`, `registrant`, `name`, `ecosystem`, `source_prefix`, `created_at`, `releases`, `compliant`, `under_bumped`, `over_bumped`, `exempt`, `edited`, `softened`, `judged`, `integrity_permille` (or null) and `last_audit_at`.

A **release** has `id`, `package_id`, `version`, `previous_version`, `declared_bump`, `initial_development`, `prerelease`, `notes_url`, `verdict`, `severity`, `audit_count`, `edit_count`, `verdict_changes`, `softened`, `first_audit_id`, `latest_audit_id`, `first_block_hash`, `latest_block_hash`, `created_at`, `last_checked_at` and `check_count`.

An **audit** has `id`, `release_id`, `requester`, `block_hash`, `block_len`, `item_count`, `breaking_entries`, `feature_entries`, `fix_entries`, `explicit_markers`, `severity`, `required_bump`, `declared_bump`, `verdict`, `evidence` (`[{i, t}]`), `injection_flagged`, `notes_changed`, `softened` and `created_at`.

## How the frontend calls it

```js
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

// reads: no account needed
const reader = createClient({ chain: studionet });
const stats = await reader.readContract({ address, functionName: "get_stats", args: [] });

// writes: the EIP-6963 provider chosen by the user signs
const writer = createClient({ chain: studionet, account: userAddress, provider });
const hash = await writer.writeContract({ address, functionName: "audit_release", args: [1, "1.4.3", "1.4.2", url], value: 0n });
```

Receipts are polled with `getTransaction` until the status is `ACCEPTED`, then until `FINALIZED`. A status of `UNDETERMINED` or `CANCELED`, or an execution result of `FINISHED_WITH_ERROR`, is reported with the contract's own tagged message.
