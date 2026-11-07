import { prefs, createStore } from "./store.js";

export const THEMES = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dim", label: "Dim", icon: "dim" },
  { id: "dark", label: "Dark", icon: "moon" },
];
const META = { light: "#f5f6fb", dim: "#232a3b", dark: "#07090f" };

export const themeStore = createStore({ theme: document.documentElement.getAttribute("data-theme") || "dark", reduced: document.documentElement.getAttribute("data-motion") === "reduced" });

export function setTheme(theme) {
  if (!META[theme]) return;
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META[theme]);
  prefs.set("theme", theme);
  themeStore.set({ theme });
  window.dispatchEvent(new CustomEvent("ba:theme", { detail: theme }));
}

export function setReducedMotion(reduced) {
  if (reduced) document.documentElement.setAttribute("data-motion", "reduced");
  else document.documentElement.removeAttribute("data-motion");
  prefs.set("motion", reduced ? "reduced" : null);
  themeStore.set({ reduced });
  window.dispatchEvent(new CustomEvent("ba:motion", { detail: reduced }));
}

export const motionReduced = () =>
  document.documentElement.getAttribute("data-motion") === "reduced" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
