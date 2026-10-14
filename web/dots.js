// Motor de puntos de la portada. Cada punto es una obra paralizada y puede
// acomodarse de varias formas; al cambiar de forma, cada punto viaja desde
// donde está a su nuevo lugar:
//
//   geo     mapa del Perú, cada punto en su distrito (tamaño = falta ejecutar)
//   avance  histograma de puntos por % de avance físico
//   tiempo  histograma de puntos por años sin avance
//   causa   barras de puntos, una fila por causa declarada
//
// Además se puede "resaltar" un subconjunto (el resto se apaga).
import { reduced } from "./motion.js";

const DUR = 950;

export function createDots({ canvas, obras, geo, colors, fmtSoles, onHover, onLeave, onPick }) {
  const ctx = canvas.getContext("2d");
  const feats = geo.departamento.features;

  const centers = new Map();
  for (const nivel of ["distrito", "provincia", "departamento"]) {
    for (const f of geo[nivel].features) centers.set(f.properties.ubigeo, centroid(f.geometry));
  }

  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  const maxSaldo = Math.max(1, ...obras.map((o) => o.saldo || 0));
  const dots = [];
  for (const o of obras) {
    const c = centers.get(o.u_dist) || centers.get(o.u_prov) || centers.get(o.u_dep);
    if (!c) continue;
    const spread = o.u_dist && centers.get(o.u_dist) ? 0.06 : 0.22;
    const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * spread;
    dots.push({
      o,
      lon: c[0] + Math.cos(ang) * rad,
      lat: c[1] + Math.sin(ang) * rad,
      rGeo: 1.6 + 6 * Math.sqrt((o.saldo || 0) / maxSaldo),
      casi: (o.avance ?? 0) >= 90,
      zone: o.u_dist || o.u_prov || o.u_dep,
      x: 0, y: 0, r: 0, a: 0,          // estado actual
      fx: 0, fy: 0, fr: 0,             // desde
      tx: 0, ty: 0, tr: 0,             // hacia
      delay: 0, j: rnd(),
    });
  }
  dots.sort((a, b) => b.rGeo - a.rGeo);

  let W = 0, H = 0, dpr = 1, outline = null, project = null;
  let mode = "geo", highlight = null, labels = [], landAlpha = 1, landTarget = 1;
  let hover = null, t0 = 0, raf = 0, animating = false, intro = true;

  // ---------- layouts ----------
  function layoutGeo() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of feats) eachCoord(f.geometry, ([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
    const pad = 16;
    const sc = Math.min((W - pad * 2) / ((x1 - x0) * k), (H - pad * 2) / (y1 - y0));
    const ox = (W - (x1 - x0) * k * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    project = (lon, lat) => [ox + (lon - x0) * k * sc, oy + (y1 - lat) * sc];
    outline = new Path2D();
    for (const f of feats) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) {
        ring.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); i ? outline.lineTo(x, y) : outline.moveTo(x, y); });
        outline.closePath();
      }
    }
    const scale = Math.max(0.7, Math.min(1.3, W / 560));
    for (const d of dots) { [d.tx, d.ty] = project(d.lon, d.lat); d.tr = d.rGeo * scale; }
    return [];
  }

  // Histograma de puntos: cada obra es un punto apilado en su columna.
  function layoutHist(value, { min, max, bins, ticks, fmt, title }) {
    const m = { l: 18, r: 18, t: 54, b: 46 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const colW = pw / bins;
    const cols = Array.from({ length: bins }, () => []);
    for (const d of dots) {
      const v = value(d.o);
      if (v == null) { d.tx = W / 2; d.ty = H + 30; d.tr = 0; continue; }
      const b = Math.max(0, Math.min(bins - 1, Math.floor(((Math.min(v, max) - min) / (max - min)) * bins)));
      cols[b].push(d);
    }
    const tallest = Math.max(...cols.map((c) => c.length));
    // Cuántos puntos caben por fila dentro de una columna, y su diámetro.
    let per = 1, cell = colW;
    while (Math.ceil(tallest / per) * cell > ph && per < 12) { per++; cell = colW / per; }
    const r = Math.max(1.2, Math.min(4.5, cell / 2 - 0.6));
    cols.forEach((col, b) => {
      col.sort((a, c) => (value(a.o) ?? 0) - (value(c.o) ?? 0));
      col.forEach((d, i) => {
        const row = Math.floor(i / per), k = i % per;
        d.tx = m.l + b * colW + (k + 0.5) * cell;
        d.ty = m.t + ph - (row + 0.5) * cell;
        d.tr = r;
      });
    });
    const out = [{ kind: "axis", x0: m.l, x1: m.l + pw, y: m.t + ph + 6 }];
    for (const t of ticks) out.push({ kind: "tick", x: m.l + ((t - min) / (max - min)) * pw, y: m.t + ph + 22, text: fmt(t) });
    out.push({ kind: "title", x: m.l, y: 24, text: title });
    return out;
  }

  function layoutCausa() {
    const groups = new Map();
    for (const d of dots) {
      const k = d.o.causal || "Sin dato";
      if (!groups.has(k)) groups.set(k, { dots: [], saldo: 0 });
      const g = groups.get(k); g.dots.push(d); g.saldo += d.o.saldo || 0;
    }
    const rows = [...groups.entries()].sort((a, b) => b[1].saldo - a[1].saldo);
    const m = { l: W < 520 ? 12 : 196, r: 16, t: 54, b: 14 };
    const pw = W - m.l - m.r, rowH = (H - m.t - m.b) / rows.length;
    const maxN = Math.max(...rows.map(([, g]) => g.dots.length));
    // El punto más grande (hasta 9 px) con el que la fila más larga cabe en su alto.
    const usable = rowH - (W < 520 ? 16 : 4);
    let cell = 9, per = Math.max(1, Math.floor(pw / cell));
    while (cell > 2 && Math.ceil(maxN / per) * cell > usable) { cell -= 0.25; per = Math.max(1, Math.floor(pw / cell)); }
    const r = Math.max(1.2, cell / 2 - 0.5);
    const out = [{ kind: "title", x: 12, y: 24, text: "Cada fila es una causa; cada punto, una obra. Ordenadas por dinero pendiente." }];
    rows.forEach(([name, g], i) => {
      const yTop = m.t + i * rowH + (W < 520 ? 14 : 0);
      g.dots.sort((a, b) => (b.o.saldo || 0) - (a.o.saldo || 0));
      g.dots.forEach((d, k) => {
        d.tx = m.l + ((k % per) + 0.5) * cell;
        d.ty = yTop + (Math.floor(k / per) + 0.5) * cell;
        d.tr = r;
      });
      out.push({ kind: "row", x: W < 520 ? 12 : 12, y: W < 520 ? m.t + i * rowH + 10 : yTop + cell * 0.8, text: name, sub: `${g.dots.length} obras, ${fmtSoles(g.saldo)}`, narrow: W < 520 });
    });
    return out;
  }

  function computeTargets() {
    if (mode === "geo") { landTarget = 1; return layoutGeo(); }
    if (!project) layoutGeo();
    landTarget = 0.18;
    if (mode === "avance") return layoutHist((o) => o.avance, {
      min: 0, max: 100, bins: 50, ticks: [0, 25, 50, 75, 100], fmt: (t) => `${t}%`,
      title: "Cada punto es una obra, según cuánto avanzó antes de pararse",
    });
    if (mode === "tiempo") return layoutHist((o) => o.anios, {
      min: 0, max: 10, bins: 40, ticks: [0, 2, 4, 6, 8, 10], fmt: (t) => (t === 10 ? "10+ años" : `${t} años`),
      title: "Cada punto es una obra, según cuánto tiempo lleva sin avance",
    });
    if (mode === "causa") return layoutCausa();
    return [];
  }

  // ---------- animación ----------
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function startTransition() {
    labels = computeTargets();
    const n = dots.length;
    dots.forEach((d, i) => {
      d.fx = d.x; d.fy = d.y; d.fr = d.r;
      d.delay = intro ? (i / n) * 900 + d.j * 250 : d.j * 260;
    });
    if (intro) dots.forEach((d) => { d.fx = d.tx + (d.j - 0.5) * W * 0.5; d.fy = -20 - d.j * H * 0.6; d.fr = d.tr; });
    t0 = performance.now();
    animating = !reduced;
    if (reduced) dots.forEach((d) => { d.x = d.tx; d.y = d.ty; d.r = d.tr; d.a = 1; });
    kick();
  }

  function draw(now) {
    raf = 0;
    ctx.clearRect(0, 0, W, H);
    const t = now - t0;
    let moving = false;

    landAlpha += (landTarget - landAlpha) * (reduced ? 1 : 0.12);
    if (Math.abs(landTarget - landAlpha) > 0.005) moving = true;
    if (outline && landAlpha > 0.02) {
      ctx.globalAlpha = landAlpha;
      ctx.fillStyle = colors.land; ctx.fill(outline);
      ctx.strokeStyle = colors.border; ctx.lineWidth = 1; ctx.stroke(outline);
      ctx.globalAlpha = 1;
    }

    const dur = intro ? 700 : DUR;
    const hz = mode === "geo" ? hover?.zone : null;
    for (const d of dots) {
      if (animating) {
        const p = Math.max(0, Math.min(1, (t - d.delay) / dur));
        if (p < 1) moving = true;
        const e = ease(p);
        d.x = d.fx + (d.tx - d.fx) * e;
        d.y = d.fy + (d.ty - d.fy) * e;
        d.r = d.fr + (d.tr - d.fr) * e;
        d.a = intro ? Math.min(1, p * 2) : 1;
      }
      if (d.r <= 0.1) continue;
      const off = (highlight && !highlight(d.o)) || (hz && d.zone !== hz);
      ctx.globalAlpha = d.a * (off ? 0.16 : 0.85);
      ctx.fillStyle = d.casi ? colors.casi : colors.dot;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!moving && animating) { animating = false; intro = false; }

    // Etiquetas: aparecen cuando los puntos ya llegaron.
    const la = animating ? Math.max(0, (t - DUR * 0.6) / 400) : 1;
    if (la > 0) drawLabels(Math.min(1, la));

    if (hover) {
      ctx.lineWidth = 2.5; ctx.strokeStyle = colors.ring;
      ctx.beginPath(); ctx.arc(hover.x, hover.y, hover.r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    if (moving || animating) kick();
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function drawLabels(alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const l of labels) {
      if (l.kind === "axis") {
        ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(l.x0, l.y); ctx.lineTo(l.x1, l.y); ctx.stroke();
      } else if (l.kind === "tick") {
        ctx.fillStyle = colors.muted; ctx.font = `500 13px ${colors.font}`; ctx.textAlign = "center";
        ctx.fillText(l.text, l.x, l.y + 4);
      } else if (l.kind === "title") {
        ctx.fillStyle = colors.muted; ctx.font = `500 14px ${colors.font}`; ctx.textAlign = "left";
        ctx.fillText(l.text, l.x, l.y, W - l.x * 2);
      } else if (l.kind === "row") {
        ctx.textAlign = "left";
        ctx.fillStyle = colors.ink; ctx.font = `600 ${l.narrow ? 12 : 14}px ${colors.cond}`;
        const name = l.text.length > 30 && !l.narrow ? l.text.slice(0, 29) + "…" : l.text;
        ctx.fillText(name, l.x, l.y, l.narrow ? W - 24 : 176);
        if (!l.narrow) {
          ctx.fillStyle = colors.muted; ctx.font = `400 12px ${colors.font}`;
          ctx.fillText(l.sub, l.x, l.y + 15, 176);
        }
      }
    }
    ctx.restore();
  }

  // ---------- interacción ----------
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = null, bd = Infinity;
    for (const d of dots) {
      if (d.r <= 0.1) continue;
      const dd = (d.x - mx) ** 2 + (d.y - my) ** 2;
      if (dd < bd && dd <= (d.r + 5) ** 2) { bd = dd; best = d; }
    }
    return best;
  }
  canvas.addEventListener("pointermove", (ev) => {
    if (animating) return;
    const d = pick(ev);
    if (d !== hover) { hover = d; kick(); }
    if (d) onHover(d.o, ev.clientX, ev.clientY); else onLeave();
    canvas.style.cursor = d ? "pointer" : "default";
  });
  canvas.addEventListener("pointerleave", () => { hover = null; kick(); onLeave(); });
  canvas.addEventListener("click", (ev) => { const d = pick(ev); if (d) onPick(d.o); });

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  let rt = 0;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      resize(); project = null; labels = computeTargets();
      dots.forEach((d) => { d.x = d.tx; d.y = d.ty; d.r = d.tr; d.a = 1; });
      animating = false; kick();
    }, 150);
  });

  resize();
  startTransition();

  return {
    setMode(next, hl = null) {
      const changed = next !== mode;
      mode = next; highlight = hl; hover = null;
      if (changed) { intro = false; startTransition(); } else kick();
    },
    get mode() { return mode; },
  };
}

function eachCoord(geom, fn) {
  const walk = (c) => (typeof c[0] === "number" ? fn(c) : c.forEach(walk));
  walk(geom.coordinates);
}

function centroid(geom) {
  if (!geom) return null;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const ring = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  let x = 0, y = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; }
  return [x / ring.length, y / ring.length];
}
