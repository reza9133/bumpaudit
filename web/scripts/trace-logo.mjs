// Traces the GenLayer logo (JPEG with black artwork on white) into a single-path SVG.
import potrace from "potrace";
import { writeFileSync } from "node:fs";
const src = process.argv[2];
const out = process.argv[3];
potrace.trace(src, { threshold: 128, turdSize: 20, optTolerance: 0.4, turnPolicy: potrace.Potrace.TURNPOLICY_MINORITY }, (err, svg) => {
  if (err) throw err;
  const d = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(" ");
  const vb = svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 400 400";
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>\n`);
  console.log("ok", vb, d.length);
});
