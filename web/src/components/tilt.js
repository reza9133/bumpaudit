import { motionReduced } from "../lib/theme.js";

/** 3D hover tilt with a moving glare. Disabled for reduced motion and touch. */
export function tilt(el, { max = 9, scale = 1.02 } = {}) {
  if (motionReduced() || window.matchMedia("(hover: none)").matches) return el;
  el.classList.add("tilt");
  let frame = 0;
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      el.style.setProperty("--ry", ((px - 0.5) * 2 * max).toFixed(2) + "deg");
      el.style.setProperty("--rx", ((0.5 - py) * 2 * max).toFixed(2) + "deg");
      el.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
      el.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
      el.style.setProperty("--ts", scale);
    });
  });
  el.addEventListener("pointerleave", () => {
    cancelAnimationFrame(frame);
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--ts", 1);
  });
  return el;
}
