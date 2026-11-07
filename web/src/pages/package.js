import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { link } from "../lib/dom.js";
import { api } from "../lib/chain.js";
import { fmtDate, timeAgo } from "../lib/format.js";
import { addrChip, bumpChip, ecoBadge, flag, gauge, severityBadge, stat, verdictBadge, verdictBar } from "../components/badges.js";
import { skeleton } from "../components/spinners.js";
import { emptyState, errorState } from "../components/states.js";
import { mochi } from "../components/brand.js";

const PAGE = 30;

export function releaseRow(r) {
  return h(
    "a",
    { class: "release-row", href: `#/release/${r.id}` },
    h("div", { class: "rr-ver" }, h("code", {}, r.version), h("span", { class: "muted small" }, "from ", h("code", {}, r.previous_version))),
    h("div", { class: "rr-bump" }, bumpChip(r.declared_bump), r.prerelease ? flag("pre", "pre-release") : null),
    h("div", { class: "rr-sev" }, severityBadge(r.severity)),
    h("div", { class: "rr-verdict" }, verdictBadge(r.verdict)),
    h("div", { class: "rr-flags" }, r.edit_count ? flag("edited", `edited ×${r.edit_count}`) : null, r.softened ? flag("softened", "softened") : null),
    h("div", { class: "rr-time muted small" }, `${r.audit_count} audit${r.audit_count === 1 ? "" : "s"} · ${timeAgo(r.last_checked_at)}`),
    icon("right", 16),
  );
}

export async function render({ params }) {
  const id = Number(params.id);
  const el = h("div", { class: "container page" }, skeleton(6, "tall"));
  if (!Number.isInteger(id) || id < 1) {
    el.replaceChildren(errorState(new Error("That is not a valid package id.")));
    return { el };
  }

  async function load() {
    el.replaceChildren(skeleton(6, "tall"));
    try {
      const [p, first] = await Promise.all([api.pkg(id), api.releases(id, 0, PAGE)]);
      let loaded = first.items.slice();
      const total = first.total;
      const list = h("div", { class: "release-list" });
      const more = h("div", { class: "center" });
      const paintReleases = () => {
        list.replaceChildren(...[...loaded].reverse().map(releaseRow));
        more.replaceChildren();
        if (loaded.length < total) {
          more.append(
            h("button", { class: "btn btn-ghost", onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                const next = await api.releases(id, loaded.length, PAGE, { force: true });
                loaded = loaded.concat(next.items);
                paintReleases();
              } catch (err) {
                more.replaceChildren(errorState(err));
              }
            } }, `Load older releases (${total - loaded.length} more)`),
          );
        }
      };
      paintReleases();

      el.replaceChildren(
        h("a", { class: "back-link", href: "#/explorer" }, icon("right", 14, { style: "transform:rotate(180deg)" }), "All packages"),
        h(
          "section",
          { class: "card pkg-hero" },
          h(
            "div",
            { class: "pkg-hero-main" },
            h("div", { class: "pkg-title" }, h("h1", {}, p.name), ecoBadge(p.ecosystem), h("span", { class: "muted" }, `#${p.id}`)),
            h("dl", { class: "kv" },
              h("dt", {}, "Source prefix"), h("dd", {}, link(p.source_prefix, [p.source_prefix, icon("external", 13)], { class: "break" })),
              h("dt", {}, "Registered by"), h("dd", {}, addrChip(p.registrant)),
              h("dt", {}, "Registered"), h("dd", {}, fmtDate(p.created_at)),
              h("dt", {}, "Last audit"), h("dd", {}, p.last_audit_at ? `${fmtDate(p.last_audit_at)} (${timeAgo(p.last_audit_at)})` : "never"),
            ),
            h("div", { class: "pkg-actions" }, h("a", { class: "btn btn-primary", href: `#/audit?tab=audit&pkg=${p.id}` }, icon("zap", 16), "Audit a release"), h("button", { class: "btn btn-ghost", onclick: load }, icon("refresh", 16), "Refresh")),
          ),
          h("div", { class: "pkg-hero-gauge" }, gauge(p.integrity_permille, { size: 132 }), h("span", { class: "muted small" }, "Integrity score"), verdictBar(p)),
        ),
        h(
          "div",
          { class: "stat-row" },
          stat("Releases audited", p.releases, null, "tag"),
          stat("Compliant", p.compliant, null, "check"),
          stat("Over-bumped", p.over_bumped, "harmless", "up"),
          stat("Under-bumped", p.under_bumped, "lowers the score", "alert"),
          stat("Exempt", p.exempt, "pre-releases", "shield"),
          stat("Edited notes", p.edited, `${p.softened} softened`, "edit"),
        ),
        h("p", { class: "notice notice-warn" }, icon("alert", 18), h("span", {}, "A package name is a claim, not an identity. Always read the source prefix above: look-alikes are separate entries with a different prefix.")),
        h("h2", {}, "Releases"),
        ...(total
          ? [list, more]
          : [emptyState({ title: "No releases audited yet", text: "Pick a release of this package and let the validators judge its notes.", mood: "think", action: h("a", { class: "btn btn-primary", href: `#/audit?tab=audit&pkg=${p.id}` }, "Audit a release") })]),
      );
    } catch (err) {
      el.replaceChildren(errorState(err, load));
    }
  }
  load();
  return { el };
}
