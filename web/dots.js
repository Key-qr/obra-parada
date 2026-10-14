// Mapa de puntos de la portada: cada punto es una obra paralizada, ubicada en
// su distrito (o en su provincia si no tiene distrito). Al cargar, los puntos
// caen y se acomodan en su lugar; al pasar el cursor se ilumina la obra y las
// demás de su mismo distrito; al hacer clic se abre su ficha.
import { reduced } from "./motion.js";

export function initDots({ canvas, obras, geo, onHover, onLeave, onPick, colors }) {
  const ctx = canvas.getContext("2d");
  const feats = geo.departamento.features;

  // Centro aproximado de cada zona (promedio de vértices del anillo mayor).
  const centers = new Map();
  for (const nivel of ["distrito", "provincia", "departamento"]) {
    for (const f of geo[nivel].features) centers.set(f.properties.ubigeo, centroid(f.geometry));
  }

  // Generador pseudoaleatorio con semilla: los puntos caen siempre igual.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  const maxSaldo = Math.max(1, ...obras.map((o) => o.saldo || 0));
  const dots = [];
  for (const o of obras) {
    const c = centers.get(o.u_dist) || centers.get(o.u_prov) || centers.get(o.u_dep);
    if (!c) continue;
    const spread = o.u_dist && centers.get(o.u_dist) ? 0.06 : 0.22; // más dispersión si solo se sabe la provincia
    const ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * spread;
    dots.push({
      o,
      lon: c[0] + Math.cos(ang) * rad,
      lat: c[1] + Math.sin(ang) * rad,
      r: 1.6 + 6 * Math.sqrt((o.saldo || 0) / maxSaldo),
      casi: (o.avance ?? 0) >= 90,
      zone: o.u_dist || o.u_prov || o.u_dep,
      delay: 0, x: 0, y: 0, sx: 0, sy: 0,
    });
  }
  // Los más grandes primero: caen antes y se dibujan debajo de los chicos.
  dots.sort((a, b) => b.r - a.r);
  dots.forEach((d, i) => (d.delay = (i / dots.length) * 900 + rnd() * 250));

  let W = 0, H = 0, dpr = 1, outline = null, project = null;
  let hover = null, t0 = performance.now(), raf = 0, settled = reduced;

  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
    for (const d of dots) {
      [d.x, d.y] = project(d.lon, d.lat);
      d.sx = d.x + (rnd() - 0.5) * W * 0.5;   // punto de partida: arriba y desordenado
      d.sy = -20 - rnd() * H * 0.6;
    }
  }

  const ease = (x) => 1 - Math.pow(1 - x, 3);

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = colors.land;
    ctx.fill(outline);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    ctx.stroke(outline);

    const t = now - t0;
    let moving = false;
    const hz = hover?.zone;
    for (const d of dots) {
      let x = d.x, y = d.y, a = 1;
      if (!settled) {
        const p = Math.max(0, Math.min(1, (t - d.delay) / 700));
        if (p < 1) moving = true;
        const e = ease(p);
        x = d.sx + (d.x - d.sx) * e;
        y = d.sy + (d.y - d.sy) * e;
        a = Math.min(1, p * 2);
      }
      const dimmed = hz && d.zone !== hz;
      ctx.globalAlpha = a * (dimmed ? 0.25 : 0.82);
      ctx.fillStyle = d.casi ? colors.casi : colors.dot;
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (hover) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colors.ring;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, hover.r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (moving) raf = requestAnimationFrame(draw);
    else { settled = true; raf = 0; }
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = null, bd = Infinity;
    for (const d of dots) {
      const dd = (d.x - mx) ** 2 + (d.y - my) ** 2;
      if (dd < bd && dd <= (d.r + 6) ** 2) { bd = dd; best = d; }
    }
    return best;
  }

  canvas.addEventListener("pointermove", (ev) => {
    if (!settled) return;
    const d = pick(ev);
    if (d !== hover) { hover = d; redraw(); }
    if (d) onHover(d.o, ev.clientX, ev.clientY);
    else onLeave();
    canvas.style.cursor = d ? "pointer" : "crosshair";
  });
  canvas.addEventListener("pointerleave", () => { hover = null; redraw(); onLeave(); });
  canvas.addEventListener("click", (ev) => { const d = pick(ev); if (d) onPick(d.o); });

  let rt = 0;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { layout(); redraw(); }, 150); });

  layout();
  // Arranca cuando el lienzo es visible (casi siempre de inmediato, está en la portada).
  t0 = performance.now();
  raf = requestAnimationFrame(draw);
  return { count: dots.length };
}

function eachCoord(geom, fn) {
  const walk = (c) => (typeof c[0] === "number" ? fn(c) : c.forEach(walk));
  walk(geom.coordinates);
}

function centroid(geom) {
  if (!geom) return null;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  // El polígono con más vértices como aproximación al principal.
  const ring = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  let x = 0, y = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; }
  return [x / ring.length, y / ring.length];
}
