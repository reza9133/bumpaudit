import { h } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { api } from "../lib/chain.js";
import { CONFIG, ECOSYSTEMS } from "../config.js";
import { pct } from "../lib/format.js";
import { wallet } from "../lib/wallet.js";
import { navigate } from "../lib/router.js";
import { stat } from "../components/badges.js";
import { skeletonGrid } from "../components/spinners.js";
import { emptyState, errorState } from "../components/states.js";
import { packageCard } from "./home.js";

export async function render() {
  const size = CONFIG.pageSize;
  let page = 0;
  let total = 0;
  let mode = "all"; // all | search | mine
  let filterEco = "all";
  let filterText = "";
  let items = [];

  const statsHost = h("div", { class: "stat-row" });
  const listHost = h("div", {});
  const pager = h("div", { class: "pager" });
  const chips = h("div", { class: "chips" });
  const searchEco = h("select", { "aria-label": "Ecosystem" }, ECOSYSTEMS.map((e) => h("option", { value: e }, e)));
  const searchName = h("input", { type: "text", placeholder: "exact package name, e.g. acme-widget", maxlength: 80, "aria-label": "Package name" });
  const jumpId = h("input", { type: "number", min: 1, placeholder: "#", "aria-label": "Package id", class: "short" });
  const filterInput = h("input", { type: "search", placeholder: "Filter this page…", "aria-label": "Filter packages on this page" });
  const tabs = h("div", { class: "tabs", role: "tablist" });

  const paintTabs = () => {
    tabs.replaceChildren(
      ...[
        ["all", "All packages", "layers"],
        ["search", "Find by name", "search"],
        ["mine", "My packages", "wallet"],
      ].map(([id, label, ic]) => h("button", { class: "tab" + (mode === id ? " active" : ""), role: "tab", "aria-selected": String(mode === id), onclick: () => { mode = id; page = 0; paintTabs(); load(); } }, icon(ic, 16), label)),
    );
    paintBar();
  };

  const paintChips = () => {
    const present = [...new Set(items.map((p) => p.ecosystem))];
    chips.replaceChildren();
    if (present.length < 2) return;
    for (const eco of ["all", ...present]) {
      chips.append(h("button", { class: "chip" + (filterEco === eco ? " active" : ""), onclick: () => { filterEco = eco; paintList(); paintChips(); } }, eco));
    }
  };

  const paintList = () => {
    const needle = filterText.trim().toLowerCase();
    const shown = items.filter((p) => (filterEco === "all" || p.ecosystem === filterEco) && (!needle || p.name.toLowerCase().includes(needle)));
    if (!shown.length) {
      listHost.replaceChildren(
        emptyState(
          mode === "mine" && wallet.get().status !== "connected"
            ? { title: "Connect a wallet", text: "Your packages are the ones registered from the connected address.", mood: "think" }
            : { title: items.length ? "Nothing matches that filter" : "No packages here yet", text: items.length ? "Clear the filter to see this page again." : "Register a package and audit a release to see it appear.", mood: "sleep", action: h("a", { class: "btn btn-primary", href: "#/audit" }, "Register a package") },
        ),
      );
      return;
    }
    listHost.replaceChildren(h("div", { class: "card-grid cols-3" }, shown.map(packageCard)));
  };

  const paintPager = () => {
    pager.replaceChildren();
    if (mode !== "all" || total <= size) return;
    const pages = Math.ceil(total / size);
    pager.append(
      h("button", { class: "btn btn-ghost btn-sm", disabled: page === 0, onclick: () => { page--; load(); } }, icon("right", 14, { style: "transform:rotate(180deg)" }), "Newer"),
      h("span", { class: "muted small" }, `Page ${page + 1} of ${pages} · ${total} packages`),
      h("button", { class: "btn btn-ghost btn-sm", disabled: page >= pages - 1, onclick: () => { page++; load(); } }, "Older", icon("right", 14)),
    );
  };

  async function load() {
    listHost.replaceChildren(skeletonGrid(6));
    pager.replaceChildren();
    try {
      if (mode === "all") {
        const s = await api.stats();
        total = s.packages;
        if (!total) items = [];
        else {
          const end = total - page * size;
          const start = Math.max(0, end - size);
          const res = await api.listPackages(start, end - start);
          items = [...res.items].reverse();
        }
      } else if (mode === "search") {
        const name = searchName.value.trim();
        if (!name) {
          items = [];
          listHost.replaceChildren(emptyState({ title: "Search by exact name", text: "Pick an ecosystem, type the package name and press Enter. Look-alike packages show up as separate entries.", mood: "think" }));
          return;
        }
        const res = await api.findPackages(searchEco.value, name, 0, 50);
        items = res.items;
      } else {
        const { account } = wallet.get();
        items = account ? (await api.registrantPackages(account)).items.slice().reverse() : [];
      }
      filterEco = "all";
      paintChips();
      paintList();
      paintPager();
    } catch (err) {
      listHost.replaceChildren(errorState(err, load));
    }
  }

  const searchBar = () =>
    mode === "search"
      ? h("form", { class: "search-bar", onsubmit: (e) => { e.preventDefault(); load(); } }, searchEco, searchName, h("button", { class: "btn btn-primary", type: "submit" }, icon("search", 16), "Search"))
      : null;
  const barHost = h("div", {});
  const paintBar = () => barHost.replaceChildren(...[searchBar()].filter(Boolean));

  filterInput.addEventListener("input", () => { filterText = filterInput.value; paintList(); });
  const unsub = wallet.subscribe((s) => { if (mode === "mine") load(); });

  const el = h(
    "div",
    { class: "container page" },
    h("div", { class: "page-head" }, h("div", {}, h("span", { class: "eyebrow" }, "Explorer"), h("h1", {}, "Audited packages"), h("p", { class: "muted" }, "Every package registered on the contract, with an integrity score based only on the releases somebody chose to audit.")), h("a", { class: "btn btn-primary", href: "#/audit" }, icon("plus", 16), "Register a package")),
    statsHost,
    h("div", { class: "toolbar" }, tabs, h("form", { class: "jump", onsubmit: (e) => { e.preventDefault(); const n = Number(jumpId.value); if (Number.isInteger(n) && n > 0) navigate(`/package/${n}`); } }, h("label", { class: "small muted" }, "Go to package"), jumpId, h("button", { class: "btn btn-ghost btn-sm", type: "submit" }, icon("arrow", 14)))),
    barHost,
    h("div", { class: "filter-row" }, chips, h("div", { class: "filter-input" }, icon("search", 16), filterInput)),
    listHost,
    pager,
  );

  (async () => {
    paintTabs();
    try {
      const s = await api.stats();
      statsHost.replaceChildren(
        stat("Packages", s.packages, null, "package"),
        stat("Releases", s.releases, null, "tag"),
        stat("Audits", s.audits, `${s.rechecks} quiet re-checks`, "file"),
        stat("Integrity", pct(s.integrity_permille), `${s.under_bumped} under-bumped of ${s.compliant + s.over_bumped + s.under_bumped} judged`, "shield"),
        stat("Edited notes", s.edited_releases, `${s.softened_releases} softened`, "edit"),
      );
    } catch {
      statsHost.replaceChildren();
    }
    load();
  })();

  return { el, destroy: unsub };
}
