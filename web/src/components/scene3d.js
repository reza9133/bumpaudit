// Three.js scenes: the hero (BumpAudit mark + orbiting verdict tags) and the GenLayer consensus scene.
// Loaded lazily, so the rest of the site never pays for it.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { GENLAYER_PATH } from "../assets/genlayer-path.js";

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function palette() {
  return {
    brand1: css("--brand-1", "#7c5cff"),
    brand2: css("--brand-2", "#22d3ee"),
    ok: css("--ok", "#22c55e"),
    bad: css("--bad", "#ef4444"),
    warn: css("--warn", "#f59e0b"),
    info: css("--info", "#38bdf8"),
    ink: css("--text", "#eef1fb"),
    surface: css("--surface", "#0e121d"),
    muted: css("--muted", "#8e98b8"),
  };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function labelTexture(text, edge, pal) {
  const c = document.createElement("canvas");
  c.width = 360;
  c.height = 112;
  const g = c.getContext("2d");
  roundRect(g, 6, 6, 348, 100, 30);
  g.fillStyle = pal.surface;
  g.globalAlpha = 0.92;
  g.fill();
  g.globalAlpha = 1;
  g.lineWidth = 5;
  g.strokeStyle = edge;
  g.stroke();
  g.font = '700 44px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = pal.ink;
  g.fillText(text, 180, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function hexShape(radius) {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function arrowShape() {
  const s = new THREE.Shape();
  const pts = [
    [0, 1.3],
    [1.0, 0.25],
    [0.4, 0.25],
    [0.4, -1.05],
    [-0.4, -1.05],
    [-0.4, 0.25],
    [-1.0, 0.25],
  ];
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

function genlayerGeometry(depth = 26) {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><path fill-rule="evenodd" d="${GENLAYER_PATH}"/></svg>`);
  const geos = [];
  for (const path of data.paths) {
    for (const shape of SVGLoader.createShapes(path)) {
      geos.push(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 3, bevelSize: 2, bevelSegments: 3, curveSegments: 10 }));
    }
  }
  const group = new THREE.Group();
  return { geos, group };
}

function supportsWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

/**
 * Mounts a scene into `host`. Returns { destroy } or null when WebGL is unavailable.
 * variant: "hero" | "consensus"
 */
export function mountScene(host, { variant = "hero", reduced = false } = {}) {
  if (!supportsWebGL()) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(variant === "hero" ? 38 : 36, 1, 0.1, 100);
  camera.position.set(0, 0, variant === "hero" ? 12 : 9.5);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.append(renderer.domElement);
  renderer.domElement.className = "scene-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.7;

  let pal = palette();
  const disposables = [];
  const track = (o) => (disposables.push(o), o);
  const themed = []; // [() => void] re-applied when the theme changes

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 6, 8);
  const rim1 = new THREE.PointLight(new THREE.Color(pal.brand1), 40, 30);
  rim1.position.set(-6, 2, 4);
  const rim2 = new THREE.PointLight(new THREE.Color(pal.brand2), 36, 30);
  rim2.position.set(6, -3, 3);
  scene.add(key, rim1, rim2);
  themed.push(() => {
    rim1.color.set(pal.brand1);
    rim2.color.set(pal.brand2);
  });

  const root = new THREE.Group();
  scene.add(root);
  const animators = [];

  if (variant === "hero") buildHero();
  else buildConsensus();

  // ---------------------------------------------------------------- hero
  function buildHero() {
    const mark = new THREE.Group();
    root.add(mark);

    const hexGeo = track(new THREE.ExtrudeGeometry(hexShape(2.1), { depth: 0.55, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelSegments: 6 }));
    hexGeo.center();
    const hexMat = track(new THREE.MeshPhysicalMaterial({ color: pal.brand1, metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15 }));
    const hex = new THREE.Mesh(hexGeo, hexMat);
    mark.add(hex);

    const arrowGeo = track(new THREE.ExtrudeGeometry(arrowShape(), { depth: 0.35, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 4 }));
    arrowGeo.center();
    const arrowMat = track(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.25, clearcoat: 0.8 }));
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set(-0.1, 0.1, 0.55);
    arrow.scale.setScalar(0.92);
    mark.add(arrow);

    // verified badge
    const badgeMat = track(new THREE.MeshPhysicalMaterial({ color: pal.ok, metalness: 0.2, roughness: 0.3, clearcoat: 1 }));
    const badge = new THREE.Mesh(track(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 48)), badgeMat);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(1.35, -1.3, 0.85);
    mark.add(badge);
    const tick = new THREE.Mesh(
      track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.28, 0.0, 0), new THREE.Vector3(-0.06, -0.24, 0), new THREE.Vector3(0.32, 0.22, 0)]), 20, 0.065, 10)),
      track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })),
    );
    tick.position.set(1.35, -1.3, 1.04);
    mark.add(tick);
    themed.push(() => {
      hexMat.color.set(pal.brand1);
      badgeMat.color.set(pal.ok);
    });

    // rings
    const ringMats = [];
    [2.9, 3.3, 3.75].forEach((r, i) => {
      const mat = track(new THREE.MeshBasicMaterial({ color: i % 2 ? pal.brand1 : pal.brand2, transparent: true, opacity: 0.55 - i * 0.1 }));
      ringMats.push(mat);
      const ring = new THREE.Mesh(track(new THREE.TorusGeometry(r, 0.014, 12, 220)), mat);
      ring.rotation.set(1.1 + i * 0.35, i * 0.6, i * 0.9);
      root.add(ring);
      animators.push((t) => {
        ring.rotation.z += 0.0016 * (i % 2 ? -1 : 1);
        ring.rotation.y += 0.0009;
      });
    });
    themed.push(() => ringMats.forEach((m, i) => m.color.set(i % 2 ? pal.brand1 : pal.brand2)));

    // orbiting version tags
    const TAGS = [
      ["1.4.2", "muted"], ["PATCH", "ok"], ["1.4.3", "muted"], ["MINOR", "info"], ["2.0.0", "muted"],
      ["MAJOR", "bad"], ["COMPLIANT", "ok"], ["UNDER_BUMPED", "bad"], ["OVER_BUMPED", "warn"], ["EXEMPT", "muted"],
    ];
    const sprites = TAGS.map(([text, tone], i) => {
      const mat = track(new THREE.SpriteMaterial({ map: labelTexture(text, pal[tone], pal), transparent: true, depthWrite: false }));
      const sprite = new THREE.Sprite(mat);
      const w = text.length > 8 ? 2.3 : 1.6;
      sprite.scale.set(w, w * (112 / 360), 1);
      root.add(sprite);
      return { sprite, mat, text, tone, phase: (i / TAGS.length) * Math.PI * 2, rx: 2.8 + (i % 3) * 0.38, ry: 1.9 + (i % 4) * 0.4, speed: 0.12 + (i % 3) * 0.035, tilt: (i % 2 ? 1 : -1) * 0.35 };
    });
    themed.push(() =>
      sprites.forEach((s) => {
        s.mat.map?.dispose();
        s.mat.map = labelTexture(s.text, pal[s.tone], pal);
        s.mat.needsUpdate = true;
      }),
    );
    animators.push((t) => {
      for (const s of sprites) {
        const a = s.phase + t * s.speed;
        s.sprite.position.set(Math.cos(a) * s.rx, Math.sin(a) * s.ry * Math.cos(s.tilt) + Math.sin(a * 2) * 0.15, Math.sin(a) * 1.7 - 0.4);
        const depth = (Math.sin(a) + 1) / 2;
        s.mat.opacity = 0.45 + depth * 0.55;
      }
    });

    // GenLayer logo, orbiting as a small 3D sculpture
    const { geos } = genlayerGeometry();
    const glMat = track(new THREE.MeshStandardMaterial({ color: pal.ink, metalness: 0.35, roughness: 0.35 }));
    const gl = new THREE.Group();
    const bbox = new THREE.Box3();
    geos.forEach((g) => {
      track(g);
      g.computeBoundingBox();
      bbox.union(g.boundingBox);
      gl.add(new THREE.Mesh(g, glMat));
    });
    const centre = bbox.getCenter(new THREE.Vector3());
    gl.children.forEach((m) => m.position.sub(centre));
    const holder = new THREE.Group();
    holder.add(gl);
    gl.scale.set(0.0042, -0.0042, 0.0042);
    root.add(holder);
    themed.push(() => glMat.color.set(pal.ink));
    animators.push((t) => {
      holder.position.set(3.1 + Math.sin(t * 0.5) * 0.12, -3.1 + Math.sin(t * 0.9) * 0.15, 1.2);
      holder.rotation.y = t * 0.8;
    });

    // particles
    const N = 520;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 5.5 + Math.random() * 7;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.7, r * Math.cos(ph) - 2], i * 3);
    }
    const pGeo = track(new THREE.BufferGeometry());
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pMat = track(new THREE.PointsMaterial({ color: pal.brand2, size: 0.045, transparent: true, opacity: 0.7, depthWrite: false }));
    const points = new THREE.Points(pGeo, pMat);
    scene.add(points);
    themed.push(() => pMat.color.set(pal.brand2));
    animators.push((t) => {
      points.rotation.y = t * 0.02;
      points.rotation.x = Math.sin(t * 0.05) * 0.1;
    });

    animators.push((t, pointer) => {
      mark.rotation.y = Math.sin(t * 0.5) * 0.35 + pointer.x * 0.5;
      mark.rotation.x = Math.sin(t * 0.4) * 0.08 - pointer.y * 0.3;
      mark.position.y = Math.sin(t * 0.9) * 0.12;
    });
  }

  // ---------------------------------------------------------------- consensus
  function buildConsensus() {
    const { geos } = genlayerGeometry(34);
    const glMat = track(new THREE.MeshPhysicalMaterial({ color: pal.ink, metalness: 0.5, roughness: 0.25, clearcoat: 0.8 }));
    const logo = new THREE.Group();
    const bbox = new THREE.Box3();
    geos.forEach((g) => {
      track(g);
      g.computeBoundingBox();
      bbox.union(g.boundingBox);
      logo.add(new THREE.Mesh(g, glMat));
    });
    const centre = bbox.getCenter(new THREE.Vector3());
    logo.children.forEach((m) => m.position.sub(centre));
    const holder = new THREE.Group();
    holder.add(logo);
    logo.scale.set(0.0072, -0.0072, 0.0072);
    root.add(holder);
    themed.push(() => glMat.color.set(pal.ink));

    // 5 validators (Studionet default) on a ring: node 0 is the leader
    const COUNT = 5;
    const R = 3.6;
    const nodes = [];
    const nodeGeo = track(new THREE.SphereGeometry(0.26, 32, 24));
    const lineMat = track(new THREE.LineBasicMaterial({ color: pal.brand2, transparent: true, opacity: 0.28 }));
    themed.push(() => lineMat.color.set(pal.brand2));
    for (let i = 0; i < COUNT; i++) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / COUNT;
      const mat = track(new THREE.MeshPhysicalMaterial({ color: i === 0 ? pal.brand1 : pal.brand2, emissive: i === 0 ? pal.brand1 : pal.brand2, emissiveIntensity: 0.3, metalness: 0.2, roughness: 0.3, clearcoat: 1 }));
      const m = new THREE.Mesh(nodeGeo, mat);
      m.position.set(Math.cos(a) * R, Math.sin(a) * R * 0.78, 0);
      root.add(m);
      nodes.push({ mesh: m, mat, leader: i === 0 });
    }
    const edgePts = [];
    for (let i = 0; i < COUNT; i++) {
      edgePts.push(nodes[i].mesh.position.clone(), nodes[(i + 1) % COUNT].mesh.position.clone());
      edgePts.push(nodes[i].mesh.position.clone(), new THREE.Vector3(0, 0, 0));
    }
    const edges = new THREE.LineSegments(track(new THREE.BufferGeometry().setFromPoints(edgePts)), lineMat);
    root.add(edges);

    const pulseMat = track(new THREE.MeshBasicMaterial({ color: pal.brand1 }));
    const pulseGeo = track(new THREE.SphereGeometry(0.09, 12, 10));
    const pulses = Array.from({ length: COUNT }, () => {
      const p = new THREE.Mesh(pulseGeo, pulseMat);
      p.visible = false;
      root.add(p);
      return p;
    });
    themed.push(() => pulseMat.color.set(pal.brand1));

    const okColor = new THREE.Color();
    const base = nodes.map((n) => n.mat.color.clone());
    themed.push(() => nodes.forEach((n, i) => { base[i].set(i === 0 ? pal.brand1 : pal.brand2); }));
    const CYCLE = 8;
    animators.push((t, pointer) => {
      holder.rotation.y = Math.sin(t * 0.45) * 0.6 + pointer.x * 0.5;
      holder.rotation.x = Math.sin(t * 0.3) * 0.1 - pointer.y * 0.25;
      root.rotation.z = Math.sin(t * 0.2) * 0.05;
      const c = (t % CYCLE) / CYCLE; // 0..1
      okColor.set(pal.ok);
      pulses.forEach((p, i) => {
        p.visible = false;
        const node = nodes[i].mesh.position;
        if (i === 0) return;
        if (c < 0.25) {
          // leader proposes
          const k = c / 0.25;
          p.visible = true;
          p.position.lerpVectors(nodes[0].mesh.position, node, k);
        } else if (c > 0.5 && c < 0.75) {
          // validators vote back to the centre
          const k = (c - 0.5) / 0.25;
          p.visible = true;
          p.position.lerpVectors(node, new THREE.Vector3(0, 0, 0), k);
        }
      });
      nodes.forEach((n, i) => {
        const accepted = c > 0.78;
        n.mat.color.copy(base[i]).lerp(okColor, accepted ? Math.min(1, (c - 0.78) / 0.08) : 0);
        n.mat.emissive.copy(n.mat.color);
        n.mat.emissiveIntensity = 0.25 + (accepted ? 0.5 * Math.sin(Math.min(1, (c - 0.78) / 0.2) * Math.PI) : 0);
        const s = 1 + (c > 0.25 && c < 0.5 && i > 0 ? 0.2 * Math.sin(((c - 0.25) / 0.25) * Math.PI) : 0);
        n.mesh.scale.setScalar(s);
      });
    });
  }

  // ---------------------------------------------------------------- loop
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e) => {
    const r = host.getBoundingClientRect();
    pointer.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    pointer.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  const resize = () => {
    const w = host.clientWidth || 1;
    const hgt = host.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 640 ? 1.5 : 2));
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    // keep the whole composition visible on narrow screens
    camera.position.z = (variant === "hero" ? 12 : 9.5) * (camera.aspect < 0.9 ? 1.5 : camera.aspect < 1.3 ? 1.2 : 1);
    camera.updateProjectionMatrix();
    renderOnce();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let visible = true;
  let running = false;
  const clock = new THREE.Clock();
  let t = 0;
  const frame = () => {
    t += Math.min(clock.getDelta(), 0.05);
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    for (const fn of animators) fn(t, pointer);
    renderer.render(scene, camera);
  };
  function renderOnce() {
    for (const fn of animators) fn(t, pointer);
    renderer.render(scene, camera);
  }
  const shouldRun = () => visible && !document.hidden && !reducedNow;
  let reducedNow = reduced;
  const sync = () => {
    if (shouldRun() && !running) {
      running = true;
      clock.getDelta();
      renderer.setAnimationLoop(frame);
    } else if (!shouldRun() && running) {
      running = false;
      renderer.setAnimationLoop(null);
    }
    if (!running) renderOnce();
  };
  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    sync();
  });
  io.observe(host);
  const onVis = () => sync();
  document.addEventListener("visibilitychange", onVis);

  const onTheme = () => {
    pal = palette();
    themed.forEach((fn) => fn());
    if (!running) renderOnce();
  };
  const onMotion = (e) => {
    reducedNow = !!e.detail;
    sync();
  };
  window.addEventListener("ba:theme", onTheme);
  window.addEventListener("ba:motion", onMotion);
  onTheme();
  resize();
  sync();

  return {
    destroy() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("ba:theme", onTheme);
      window.removeEventListener("ba:motion", onMotion);
      scene.traverse((o) => {
        if (o.material?.map) o.material.map.dispose();
      });
      disposables.forEach((d) => d.dispose?.());
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
}
