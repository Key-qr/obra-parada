// Dónde dibujar cada obra y cada nombre de lugar en el mapa del explorador.
// La base trae el distrito de cada obra, no sus coordenadas: cada obra va dentro de su distrito,
// repartida en espiral alrededor del centro para que las de un mismo distrito no se encimen.

function areaYCentro(anillo) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [x0, y0] = anillo[j], [x1, y1] = anillo[i];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a /= 2;
  return a ? { a: Math.abs(a), c: [cx / (6 * a), cy / (6 * a)] } : { a: 0, c: anillo[0] };
}

function dentro([x, y], anillo) {
  let d = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

// El polígono más grande de la zona (los distritos con islas tienen varios).
function mayor(geom) {
  const polis = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let best = null;
  for (const p of polis) {
    const r = areaYCentro(p[0]);
    if (!best || r.a > best.a) best = { ...r, anillo: p[0] };
  }
  return best;
}

// Centro visible de cada zona: el centroide si cae dentro; si no (zonas en forma de media luna),
// el punto de una grilla interior más cercano a él.
function centroDe(geom) {
  const m = mayor(geom);
  if (!m) return null;
  if (dentro(m.c, m.anillo)) return { c: m.c, anillo: m.anillo };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of m.anillo) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  let best = null, bd = Infinity;
  for (let i = 1; i < 14; i++) for (let j = 1; j < 14; j++) {
    const p = [x0 + ((x1 - x0) * i) / 14, y0 + ((y1 - y0) * j) / 14];
    if (!dentro(p, m.anillo)) continue;
    const d = (p[0] - m.c[0]) ** 2 + (p[1] - m.c[1]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return { c: best || m.c, anillo: m.anillo };
}

// nivel -> Map(ubigeo -> { c: [lng, lat], anillo, r })
export function centros(GEO) {
  const out = {};
  for (const [nivel, fc] of Object.entries(GEO)) {
    const m = new Map();
    for (const f of fc.features) {
      const z = centroDe(f.geometry);
      if (!z) continue;
      // Radio para repartir obras: una fracción del ancho de la zona.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of z.anillo) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      z.r = Math.min(x1 - x0, y1 - y0) * 0.22;
      m.set(f.properties.ubigeo, z);
    }
    out[nivel] = m;
  }
  return out;
}

// Posición de cada obra (índice -> [lng, lat]) en la zona más fina donde se ubicó.
export function posiciones(obras, CENTRO) {
  const grupos = new Map();
  for (const o of obras) {
    const z = (o.u_dist && CENTRO.distrito.get(o.u_dist) && ["distrito", o.u_dist])
      || (o.u_prov && CENTRO.provincia.get(o.u_prov) && ["provincia", o.u_prov])
      || (o.u_dep && CENTRO.departamento.get(o.u_dep) && ["departamento", o.u_dep]);
    if (!z) continue;
    const k = z.join("/");
    if (!grupos.has(k)) grupos.set(k, { z: CENTRO[z[0]].get(z[1]), obras: [] });
    grupos.get(k).obras.push(o);
  }
  const pos = new Map();
  for (const { z, obras: lista } of grupos.values()) {
    lista.sort((a, b) => (b.saldo || 0) - (a.saldo || 0));
    const n = lista.length;
    lista.forEach((o, k) => {
      if (n === 1) { pos.set(o._i, z.c); return; }
      // Espiral de Fermat: la de más dinero al centro y las demás alrededor.
      let r = z.r * Math.sqrt((k + 0.5) / n), p;
      for (let t = 0; t < 4; t++, r /= 2) {
        const ang = k * 2.39996;
        p = [z.c[0] + r * Math.cos(ang), z.c[1] + r * Math.sin(ang) * 0.92];
        if (dentro(p, z.anillo)) break;
        p = z.c;
      }
      pos.set(o._i, p);
    });
  }
  return pos;
}

// Nombres de lugares sobre el mapa, como marcadores HTML (el mapa no carga fuentes de etiquetas).
// Se ponen de la zona con más dinero pendiente a la que menos y se salta la que se encimaría.
export function crearEtiquetas(maplibregl, map) {
  const vivas = new Map();
  return function pintar(items) {
    const keep = new Set();
    const cajas = [];
    const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
    for (const it of items) {
      if (keep.size >= 90) break;
      const p = map.project(it.c);
      if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) continue;
      const w = it.nombre.length * 6.9 + it.sub.length * 7 + 26, h = 22;
      // Arriba del punto; si ahí choca con otro nombre, debajo.
      const opciones = [
        { anchor: "bottom", caja: { l: p.x - w / 2, r: p.x + w / 2, t: p.y - h - 6, b: p.y - 2 } },
        { anchor: "top", caja: { l: p.x - w / 2, r: p.x + w / 2, t: p.y + 2, b: p.y + h + 6 } },
      ];
      const libre = opciones.find((o) => !cajas.some((c) => !(o.caja.l > c.r || o.caja.r < c.l || o.caja.t > c.b || o.caja.b < c.t)));
      if (!libre) continue;
      cajas.push(libre.caja);
      keep.add(it.key);
      let m = vivas.get(it.key);
      const html = `<b>${it.nombre}</b><small>${it.sub}</small>`;
      if (m && m._anchorElegido !== libre.anchor) { m.remove(); vivas.delete(it.key); m = null; }
      if (!m) {
        const el = document.createElement("div");
        el.className = "zlabel";
        el.innerHTML = html;
        el.title = it.title || "";
        m = new maplibregl.Marker({ element: el, anchor: libre.anchor, offset: [0, libre.anchor === "bottom" ? -5 : 5] }).setLngLat(it.c).addTo(map);
        m._anchorElegido = libre.anchor;
        vivas.set(it.key, m);
      } else if (m.getElement().innerHTML !== html) m.getElement().innerHTML = html;
    }
    for (const [k, m] of vivas) if (!keep.has(k)) { m.remove(); vivas.delete(k); }
  };
}
