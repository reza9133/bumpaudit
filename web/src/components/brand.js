import { h } from "../lib/dom.js";
import { GENLAYER_PATH, GENLAYER_VIEWBOX } from "../assets/genlayer-path.js";

let gradientCounter = 0;

/** The BumpAudit mark: a hexagonal seal with an upward "bump" arrow and a verified badge. */
export function bumpLogo(size = 36, props = {}) {
  const id = "bl" + ++gradientCounter;
  const svg = h("svg:svg", { viewBox: "0 0 64 64", width: size, height: size, role: "img", "aria-label": "BumpAudit logo", class: "brand-mark " + (props.class || "") });
  svg.innerHTML = `
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
    <path d="M32 5 L54 18 V46 L32 59 L10 46 V18 Z" fill="url(#${id})" stroke="url(#${id})" stroke-width="5" stroke-linejoin="round"/>
    <path class="bm-arrow" d="M21 32 L32 21 L43 32 M32 22 V43" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="46" cy="46" r="10" fill="#22c55e" stroke="var(--logo-ring, #0b1020)" stroke-width="3"/>
    <path d="M41.5 46.5 l3.2 3.2 l5.3 -6.4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
}

export function wordmark() {
  return h("span", { class: "wordmark" }, "Bump", h("b", {}, "Audit"));
}

/** The GenLayer logo, drawn in currentColor so it follows every theme. */
export function genlayerLogo(size = 28, props = {}) {
  const svg = h("svg:svg", { viewBox: GENLAYER_VIEWBOX, width: size, height: size, role: "img", "aria-label": "GenLayer logo", class: "gl-logo " + (props.class || "") });
  svg.innerHTML = `<path fill="currentColor" fill-rule="evenodd" d="${GENLAYER_PATH}"/>`;
  return svg;
}

// ---- Mochi, the project mascot -------------------------------------------------------------
// Artwork lives in src/assets: mochi.png (full body) and mochi-head.png (close-up used at small sizes).
// If mochi.png is deleted, the built-in drawing below is used instead.
const full = import.meta.glob("../assets/mochi.{png,webp,jpg,jpeg,svg}", { eager: true, query: "?url", import: "default" });
const head = import.meta.glob("../assets/mochi-head.{png,webp,jpg,jpeg,svg}", { eager: true, query: "?url", import: "default" });
const customUrl = Object.values(full)[0] || null;
const headUrl = Object.values(head)[0] || customUrl;
const FULL = { w: 619, h: 960, cx: 332.5, cy: 201.5, k: 107 / 160 }; // mochi.png: eye midpoint and scale (eye span = 160 units)
const HEAD = { w: 440, h: 449, cx: 240, cy: 305, k: 1 }; // mochi-head.png
const HEAD_MAX = 120; // at or below this size the close-up is shown, above it the full figure

// The artwork has one expression. For every other mood a patch covers the original eyes and mouth on the
// visor and the mood's face is drawn on top, in the same units (origin = midpoint between the eyes).
const CY = "#22e6e3";
const FACES = {
  think: `<g class="mf mf-think"><circle cx="-80" cy="-6" r="24" fill="${CY}"/><circle cx="80" cy="-6" r="24" fill="${CY}"/>
    <circle cx="-72" cy="-14" r="9" fill="#05080a"/><circle cx="88" cy="-14" r="9" fill="#05080a"/>
    <g class="mf-dots" fill="${CY}"><circle cx="-22" cy="74" r="6"/><circle cx="0" cy="74" r="6"/><circle cx="22" cy="74" r="6"/></g></g>`,
  cheer: `<g class="mf mf-cheer" fill="none" stroke="${CY}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-112 16 Q-80 -34 -48 16" stroke-width="15"/><path d="M48 16 Q80 -34 112 16" stroke-width="15"/>
    <path d="M-36 52 H36 Q32 94 0 94 Q-32 94 -36 52 Z" fill="${CY}" stroke-width="6"/>
    <g class="mf-spark" fill="${CY}" stroke="none"><path d="M-128 -34 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 z"/><path d="M128 -34 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 z"/></g></g>`,
  alert: `<g class="mf mf-alert" fill="none" stroke="#ff7a59" stroke-linecap="round">
    <circle cx="-80" cy="0" r="30" stroke-width="9"/><circle cx="80" cy="0" r="30" stroke-width="9"/>
    <circle cx="-80" cy="0" r="10" fill="#ff7a59" stroke="none"/><circle cx="80" cy="0" r="10" fill="#ff7a59" stroke="none"/>
    <ellipse cx="0" cy="76" rx="13" ry="17" stroke-width="8"/></g>`,
  sleep: `<g class="mf mf-sleep" fill="none" stroke="#7fc4cf" stroke-linecap="round">
    <path d="M-112 -2 Q-80 30 -48 -2" stroke-width="13"/><path d="M48 -2 Q80 30 112 -2" stroke-width="13"/>
    <path d="M-12 74 Q0 82 12 74" stroke-width="8"/>
    <g class="mf-z" fill="#7fc4cf" stroke="none" font-family="Inter,system-ui,sans-serif" font-weight="800"><text x="96" y="-28" font-size="40">z</text><text x="124" y="-58" font-size="30">z</text></g></g>`,
};
function faceOverlay(g, mood) {
  const face = FACES[mood];
  if (!face) return "";
  return `<svg class="mochi-face" viewBox="0 0 ${g.w} ${g.h}" aria-hidden="true">
    <defs><filter id="mf-feather" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
    <linearGradient id="mf-visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#040506"/><stop offset="1" stop-color="#14171a"/></linearGradient></defs>
    <g transform="translate(${g.cx} ${g.cy}) rotate(-1.7) scale(${g.k})">
      <rect x="-142" y="-50" width="282" height="146" rx="38" fill="url(#mf-visor)" filter="url(#mf-feather)"/>${face}</g></svg>`;
}

const MOCHI_SVG = `
  <ellipse class="m-shadow" cx="80" cy="141" rx="46" ry="6"/>
  <g class="m-body-g">
    <path class="m-body" d="M22 112 C14 84 34 46 80 44 C126 46 146 84 138 112 C134 130 112 136 80 136 C48 136 26 130 22 112 Z"/>
    <path class="m-shine" d="M42 76 C48 62 60 54 74 51"/>
    <path class="m-leaf" d="M80 44 C78 33 87 25 100 25 C100 36 93 44 80 44 Z"/>
    <path class="m-vein" d="M83 41 C89 36 93 32 97 28"/>
    <ellipse class="m-cheek" cx="47" cy="104" rx="8" ry="5"/>
    <ellipse class="m-cheek" cx="113" cy="104" rx="8" ry="5"/>
    <g class="m-eyes-open">
      <ellipse class="m-eye" cx="62" cy="94" rx="5.5" ry="7"/>
      <ellipse class="m-eye" cx="98" cy="94" rx="5.5" ry="7"/>
      <circle class="m-glint" cx="64" cy="91.5" r="2"/>
      <circle class="m-glint" cx="100" cy="91.5" r="2"/>
    </g>
    <g class="m-eyes-closed"><path d="M56 96 Q62 89 68 96"/><path d="M92 96 Q98 89 104 96"/></g>
    <path class="m-mouth" d="M73 106 Q80 113 87 106"/>
    <ellipse class="m-arm" cx="24" cy="110" rx="6" ry="9" transform="rotate(24 24 110)"/>
  </g>
  <g class="m-glass">
    <line class="m-handle" x1="141" y1="106" x2="154" y2="124"/>
    <circle class="m-lens" cx="132" cy="94" r="14"/>
    <path class="m-lens-shine" d="M124 88 Q127 83 133 82"/>
    <path class="m-check" d="M126 95 l4 4 l8 -9"/>
  </g>
  <text class="m-mark m-q" x="124" y="40" font-size="22" font-weight="800">?</text>
  <text class="m-mark m-ex" x="124" y="40" font-size="24" font-weight="800">!</text>
  <text class="m-mark m-zzz" x="116" y="42" font-size="18" font-weight="800">z</text>`;

/** mood: happy | think | sleep | alert | cheer */
export function mochi({ mood = "happy", size = 120, class: extra = "" } = {}) {
  if (customUrl) {
    const closeUp = size <= HEAD_MAX;
    const g = closeUp ? HEAD : FULL;
    const height = closeUp ? size : Math.round(size * 1.5);
    const width = Math.round((height * g.w) / g.h);
    const wrap = h("span", { class: `mochi-wrap mochi-custom mochi-${mood} ${closeUp ? "mochi-closeup" : "mochi-fullbody"} ${extra}`, style: { width: width + "px", height: height + "px" } });
    wrap.append(h("img", { class: "mochi-img", src: closeUp ? headUrl : customUrl, alt: "Mochi, the BumpAudit mascot", loading: "lazy", draggable: "false" }));
    wrap.insertAdjacentHTML("beforeend", faceOverlay(g, mood));
    return wrap;
  }
  const wrap = h("span", { class: `mochi-wrap ${extra}`, style: { width: size + "px", height: size * 0.94 + "px" } });
  const svg = h("svg:svg", { viewBox: "0 0 160 150", class: `mochi mochi-${mood}`, role: "img", "aria-label": "Mochi, the BumpAudit mascot" });
  svg.innerHTML = MOCHI_SVG;
  wrap.append(svg);
  return wrap;
}
