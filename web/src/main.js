import "./styles/base.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/motion.css";
import { h } from "./lib/dom.js";
import { route, notFound, startRouter } from "./lib/router.js";
import { startDiscovery, autoReconnect } from "./lib/wallet.js";
import { renderHeader } from "./components/header.js";
import { renderFooter } from "./components/footer.js";
import { networkBanner } from "./components/networkBanner.js";
import { themeStore } from "./lib/theme.js";

route("/", () => import("./pages/home.js"));
route("/explorer", () => import("./pages/explorer.js"), () => "Explorer");
route("/package/:id", () => import("./pages/package.js"), (p) => `Package #${p.id}`);
route("/release/:id", () => import("./pages/release.js"), (p) => `Release #${p.id}`);
route("/audit", () => import("./pages/audit.js"), () => "Register & audit");
route("/tools", () => import("./pages/tools.js"), () => "Tools");
route("/docs", () => import("./pages/docs.js"), () => "Docs");
route("/docs/:slug", () => import("./pages/docs.js"), () => "Docs");
route("/about", () => import("./pages/about.js"), () => "About");
route("/settings", () => import("./pages/settings.js"), () => "Settings");
notFound(() => import("./pages/notfound.js"));

const app = document.getElementById("app");
const main = h("main", { id: "main", tabindex: "-1" });
app.append(
  h("a", { class: "skip-link", href: "#main", onclick: (e) => { e.preventDefault(); main.focus(); } }, "Skip to content"),
  renderHeader(),
  networkBanner(),
  main,
  renderFooter(),
);

startDiscovery();
autoReconnect();
startRouter(main);
themeStore.get();

requestAnimationFrame(() => {
  const splash = document.getElementById("splash");
  if (splash) {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 500);
  }
});
