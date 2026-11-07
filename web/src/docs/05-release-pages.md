title: Release pages
group: Guides
summary: What the parser expects, so that your audit does not revert.

## Headings

The audited version must appear as a **heading-like line**. All of these work for `2.0.0`:

```
## [2.0.0] - 2026-03-01      v2.0.0            Version 2.0.0          2.0.0 / 2026-03-01
### 2.0.0 (2026-03-01)       **2.0.0**         Release notes for 2.0.0   What's new in v2.0.0
```

Good evidence pages: a GitHub release page (`.../releases/tag/v2.0.0`), a `CHANGELOG.md` (raw or rendered), or a docs-site changelog.

## Rules of thumb

- The section runs from the heading to the next heading of **a different version**. A line that merely begins with a version number (`3.2.1 and earlier are affected ...`) is read as the next heading. That is a deliberate trade-off: titled headings (`## 2.0.0 - Big rewrite`) must end the previous section.
- Prose that merely mentions a version (`Fixed a regression from 2.0.0`) and bullets (`- 2.0.0 shipped`) are not headings.
- At most 60 entries (300 characters each) and 6000 characters of a section are audited. The stored section shows exactly what was read, so truncation is never hidden.
- A page that renders as a single long line cannot be parsed.

## Choosing the source prefix

Pick the narrowest prefix only maintainers can write to, such as `https://github.com/acme/widget/releases/` or the raw `CHANGELOG.md` path, not the whole repository. Issue and pull-request pages under a repository are user-writable.

## When an audit reverts

Errors are tagged. `[EXPECTED]` is a mistake in the input; `[EXTERNAL]` is about the page or the network.

| Message | What to do |
|---|---|
| no heading for this version was found | Run the [Parser preview](#/tools) with the page text and fix the URL or pick a page where the version is a heading. |
| section is empty | The heading exists but nothing under it reads as an entry. |
| could not fetch the page | The URL must be public and reachable; try again later. |
| validators could not agree | A dynamic page may differ between fetches. Nothing was recorded; retry, or use the raw file. |
