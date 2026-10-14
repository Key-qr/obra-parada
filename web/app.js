// Obra Parada: todo se calcula en el navegador a partir de data/*.json.
// Sin backend: los filtros recalculan agregados sobre ~2,500 filas al vuelo.
import { reduced, scramble, decodeOnView, countTo, readingProgress, revealOnView, makeTerminal, scrollSteps } from "./motion.js";
import { createDots } from "./dots.js";
import { TIPOS, tipoDe, renderTipos, bindTipos, renderRecords, renderTimeline, renderGob, initCompare } from "./sections.js";

const NIVELES = {
  departamento: { key: "u_dep", geo: "data/geo/departamentos.json", label: "Departamento" },
  provincia: { key: "u_prov", geo: "data/geo/provincias.json", label: "Provincia" },
  distrito: { key: "u_dist", geo: "data/geo/distritos.json", label: "Distrito" },
};
const RAMP = ["--r1", "--r2", "--r3", "--r4", "--r5"].map(cssVar);
const ZERO = cssVar("--r0");
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const PAGE = 12;

const state = {
  nivel: "departamento",
  metrica: "saldo",
  gob: "", causal: "", sector: "", tipo: "", mitad: false,
  tlMetric: "obras",
  sel: null,          // { nivel, ubigeo }
  entSort: "saldo",
  tresD: false,
  listLimit: PAGE,
};

let OBRAS = [];
let GEO = {};          // nivel -> FeatureCollection
let ZONES = {};        // nivel -> Map(ubigeo -> {nombre, padre, bbox})
let map;
let breaks = [];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---------- formato ----------
const nf = new Intl.NumberFormat("es-PE");
const nf1 = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });
function soles(v) {
  if (v == null) return "Sin dato";
  if (v >= 1e9) return `S/ ${nf1.format(v / 1e9)} mil millones`;
  if (v >= 1e6) return `S/ ${nf1.format(v / 1e6)} millones`;
  if (v >= 1e3) return `S/ ${nf.format(Math.round(v / 1e3))} mil`;
  return `S/ ${nf.format(Math.round(v))}`;
}
function solesCorto(v) {
  if (v == null) return "–";
  if (v >= 1e9) return `S/ ${nf1.format(v / 1e9)} mil M`;
  if (v >= 1e6) return `S/ ${nf1.format(v / 1e6)} M`;
  if (v >= 1e3) return `S/ ${nf.format(Math.round(v / 1e3))} mil`;
  return `S/ ${nf.format(Math.round(v))}`;
}
function fecha(iso) {
  if (!iso) return "Sin dato";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}
function anios(v) {
  if (v == null) return "–";
  return v < 1 ? `${Math.round(v * 12)} meses` : `${nf1.format(v)} años`;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ---------- datos ----------
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo cargar ${url} (${r.status})`);
  return r.json();
}

async function load() {
  const [obras, resumen, meta, ...topos] = await Promise.all([
    getJSON("data/obras.json"),
    getJSON("data/resumen.json"),
    getJSON("data/meta.json"),
    ...Object.values(NIVELES).map((n) => getJSON(n.geo)),
  ]);
  OBRAS = obras.rows.map((r) => Object.fromEntries(obras.cols.map((c, i) => [c, r[i]])));
  OBRAS.forEach((o, i) => { o._i = i; o.tipo = tipoDe(o.nombre); });

  Object.keys(NIVELES).forEach((nivel, i) => {
    const topo = topos[i];
    const fc = topojson.feature(topo, topo.objects[Object.keys(topo.objects)[0]]);
    // El índice de zonas incluye todo; el mapa solo lo que tiene polígono.
    // (8 distritos vienen sin geometría en la fuente del INEI, p. ej. Santa Anita.)
    ZONES[nivel] = new Map(
      fc.features.map((f) => [f.properties.ubigeo, {
        nombre: titulo(f.properties.nombre),
        padre: [f.properties.provincia, f.properties.departamento].filter(Boolean).map(titulo).join(", "),
        bbox: f.geometry ? bbox(f.geometry) : null,
        sinPoligono: !f.geometry,
      }])
    );
    fc.features = fc.features.filter((f) => f.geometry);
    GEO[nivel] = fc;
  });
  // Nombres con tildes desde los datos (el mapa del INEI viene sin tildes).
  OBRAS.forEach((o) => {
    const z = ZONES.departamento.get(o.u_dep);
    if (z && o.dep) z.nombre = o.dep;
  });
  return { resumen, meta };
}

const MENORES = new Set(["de", "del", "la", "las", "los", "y", "el"]);
function titulo(s) {
  return String(s ?? "").toLowerCase().split(/\s+/).map((w, i) => (i && MENORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

function bbox(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]);
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  return [[x0, y0], [x1, y1]];
}

// ---------- filtros y agregados ----------
function filtered() {
  return OBRAS.filter((o) =>
    (!state.gob || o.nivel === state.gob) &&
    (!state.causal || o.causal === state.causal) &&
    (!state.sector || o.sector === state.sector) &&
    (!state.tipo || o.tipo === state.tipo) &&
    (!state.mitad || (o.avance ?? 0) >= 50)
  );
}

function inSelection(rows) {
  if (!state.sel) return rows;
  const key = NIVELES[state.sel.nivel].key;
  return rows.filter((o) => o[key] === state.sel.ubigeo);
}

function aggregate(rows, nivel) {
  const key = NIVELES[nivel].key;
  const m = new Map();
  for (const o of rows) {
    const k = o[key];
    if (!k) continue;
    const a = m.get(k) || { obras: 0, saldo: 0, costo: 0 };
    a.obras += 1; a.saldo += o.saldo || 0; a.costo += o.costo || 0;
    m.set(k, a);
  }
  return m;
}

function median(xs) {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const h = Math.floor(v.length / 2);
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

function quantileBreaks(values, n = 5) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const out = [];
  for (let i = 1; i < n; i++) out.push(v[Math.min(v.length - 1, Math.floor((i * v.length) / n))]);
  return [...new Set(out)];
}

// ---------- mapa ----------
function initMap() {
  map = new maplibregl.Map({
    container: "map",
    style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": cssVar("--concreto-2") } }] },
    bounds: [[-81.4, -18.4], [-68.6, -0.05]],
    fitBoundsOptions: { padding: 20 },
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    minZoom: 3.5,
    maxZoom: 11,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Límites: INEI" }));
  map.touchZoomRotate.disableRotation();

  return new Promise((resolve) => map.on("load", () => {
    for (const nivel of Object.keys(NIVELES)) {
      map.addSource(nivel, { type: "geojson", data: GEO[nivel], promoteId: "ubigeo" });
      map.addLayer({
        id: `${nivel}-fill`, type: "fill", source: nivel,
        layout: { visibility: nivel === state.nivel ? "visible" : "none" },
        paint: {
          "fill-color": ZERO,
          // "off": aún no "construida" en la animación de entrada; "dim": atenuada al pasar el cursor por una causa o entidad.
          "fill-opacity": ["case", ["boolean", ["feature-state", "off"], false], 0.08, ["boolean", ["feature-state", "dim"], false], 0.16, 1],
        },
      });
      map.addLayer({
        id: `${nivel}-line`, type: "line", source: nivel,
        layout: { visibility: nivel === state.nivel ? "visible" : "none" },
        paint: { "line-color": "#f4f5f3", "line-width": nivel === "distrito" ? 0.35 : nivel === "provincia" ? 0.6 : 1 },
      });
      map.addLayer({
        id: `${nivel}-sel`, type: "line", source: nivel,
        layout: { visibility: nivel === state.nivel ? "visible" : "none" },
        paint: {
          "line-color": cssVar("--ambar"),
          "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 3.5, ["boolean", ["feature-state", "hover"], false], 2, 0],
        },
      });
      // Relieve 3D: la altura es el valor de la métrica, normalizado en feature-state "h".
      map.addLayer({
        id: `${nivel}-3d`, type: "fill-extrusion", source: nivel,
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": ZERO,
          "fill-extrusion-height": ["*", ["coalesce", ["feature-state", "h"], 0], nivel === "departamento" ? 260000 : nivel === "provincia" ? 160000 : 90000],
          "fill-extrusion-opacity": 0.92,
        },
      });
      bindLayer(nivel);
    }
    // Bordes de departamento siempre visibles como referencia.
    map.addLayer({ id: "dep-ref", type: "line", source: "departamento", paint: { "line-color": "#f4f5f3", "line-width": 1.4 } });
    resolve();
  }));
}

let hovered = null;
function bindLayer(nivel) {
  const layer = `${nivel}-fill`;
  const tip = document.getElementById("tooltip");
  map.on("mousemove", layer, (e) => {
    const f = e.features[0];
    if (!f) return;
    map.getCanvas().style.cursor = "pointer";
    if (hovered && hovered.id !== f.id) map.setFeatureState(hovered, { hover: false });
    hovered = { source: nivel, id: f.id };
    map.setFeatureState(hovered, { hover: true });
    const z = ZONES[nivel].get(f.id);
    const st = map.getFeatureState({ source: nivel, id: f.id });
    tip.innerHTML = zoneTip(nivel, f.id, z, st);
    tip.hidden = false;
    const pad = 14;
    const x = Math.min(e.originalEvent.clientX + pad, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.min(e.originalEvent.clientY + pad, window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  });
  map.on("mouseleave", layer, () => {
    map.getCanvas().style.cursor = "";
    if (hovered) map.setFeatureState(hovered, { hover: false });
    hovered = null;
    tip.hidden = true;
  });
  map.on("click", layer, (e) => {
    const f = e.features[0];
    if (f) select(nivel, f.id, { fit: false });
  });
}

// Tarjeta del tooltip: totales de la zona, cuánto pesa en el país y su obra más cara.
let tipCache = { key: "", rows: [] };
function zoneTip(nivel, id, z, st) {
  const head = `<b>${esc(z?.nombre)}</b>${z?.padre ? `<span class="t-sub">${esc(z.padre)}</span>` : ""}`;
  if (!st.obras) return `${head}<span class="t-empty">Sin obras paralizadas con estos filtros</span>`;
  const cacheKey = JSON.stringify([state.gob, state.causal, state.sector, state.mitad]);
  if (tipCache.key !== cacheKey) tipCache = { key: cacheKey, rows: filtered() };
  const key = NIVELES[nivel].key;
  const enZona = tipCache.rows.filter((o) => o[key] === id);
  const total = tipCache.rows.reduce((s, o) => s + (o.saldo || 0), 0) || 1;
  const share = (st.saldo / total) * 100;
  const top = enZona.reduce((a, o) => ((o.saldo || 0) > (a?.saldo || 0) ? o : a), null);
  const casi = enZona.filter((o) => (o.avance ?? 0) >= 90).length;
  return `${head}
    <span class="t-row"><span>${nf.format(st.obras)} ${st.obras === 1 ? "obra" : "obras"}</span><strong>${solesCorto(st.saldo)}</strong></span>
    <span class="t-share"><i style="width:${Math.max(2, Math.min(100, share * 4))}%"></i></span>
    <span class="t-note">${share < 0.1 ? "menos de 0.1" : nf1.format(share)}% de lo que falta ejecutar en el país${casi ? `, ${casi} a un paso de terminar` : ""}</span>
    ${top ? `<span class="t-top">La más cara: ${esc(top.nombre.length > 70 ? top.nombre.slice(0, 68) + "…" : top.nombre)}</span>` : ""}`;
}

// ---------- resaltados cruzados (lista, causas, entidades -> mapa) ----------
// Atenúa todas las zonas del nivel visible salvo las de `keep` (Set de ubigeos).
function dimExcept(keep) {
  const nivel = state.nivel;
  for (const f of GEO[nivel].features) {
    map.setFeatureState({ source: nivel, id: f.properties.ubigeo }, { dim: keep ? !keep.has(f.properties.ubigeo) : false });
  }
}
function zonesWhere(pred) {
  const key = NIVELES[state.nivel].key;
  return new Set(inSelection(filtered()).filter(pred).map((o) => o[key]).filter(Boolean));
}
let pulsed = null;
function pulseZone(o) {
  if (pulsed) map.setFeatureState(pulsed, { hover: false });
  pulsed = null;
  if (!o) return;
  const id = o[NIVELES[state.nivel].key];
  if (!id) return;
  pulsed = { source: state.nivel, id };
  map.setFeatureState(pulsed, { hover: true });
}

// Animación de entrada del mapa: las zonas se "construyen" de la que más
// dinero pendiente tiene a la que menos, la primera vez que el mapa se ve.
function buildInMap() {
  const nivel = state.nivel;
  const order = GEO[nivel].features
    .map((f) => ({ id: f.properties.ubigeo, v: map.getFeatureState({ source: nivel, id: f.properties.ubigeo }).saldo || 0 }))
    .sort((a, b) => b.v - a.v);
  if (reduced) return;
  order.forEach(({ id }) => map.setFeatureState({ source: nivel, id }, { off: true }));
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    const total = 1100, start = performance.now();
    let done = 0;
    const frame = (now) => {
      const upto = Math.min(order.length, Math.ceil(((now - start) / total) * order.length));
      for (; done < upto; done++) map.setFeatureState({ source: nivel, id: order[done].id }, { off: false });
      if (done < order.length) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, { threshold: 0.35 });
  io.observe(document.getElementById("map"));
}

function setLayerVisibility() {
  for (const nivel of Object.keys(NIVELES)) {
    const vis = nivel === state.nivel ? "visible" : "none";
    ["fill", "line", "sel"].forEach((t) => map.setLayoutProperty(`${nivel}-${t}`, "visibility", vis));
    map.setLayoutProperty(`${nivel}-3d`, "visibility", nivel === state.nivel && state.tresD ? "visible" : "none");
  }
}

function paintMap(rows) {
  const nivel = state.nivel;
  const agg = aggregate(rows, nivel);
  const metric = state.metrica;
  breaks = quantileBreaks([...agg.values()].map((a) => a[metric]));
  const maxV = Math.max(1, ...[...agg.values()].map((a) => a[metric]));
  const colorOf = (v) => {
    if (!v) return 0;
    let c = 1;
    for (const b of breaks) if (v > b) c++;
    return c;
  };
  for (const f of GEO[nivel].features) {
    const id = f.properties.ubigeo;
    const a = agg.get(id);
    map.setFeatureState({ source: nivel, id }, {
      obras: a?.obras || 0, saldo: a?.saldo || 0, c: colorOf(a?.[metric] || 0), h: a ? a[metric] / maxV : 0,
    });
  }
  const expr = ["match", ["coalesce", ["feature-state", "c"], 0], 0, ZERO];
  RAMP.forEach((col, i) => expr.push(i + 1, col));
  expr.push(ZERO);
  map.setPaintProperty(`${nivel}-fill`, "fill-color", expr);
  map.setPaintProperty(`${nivel}-3d`, "fill-extrusion-color", expr);
  renderLegend();

  lastSinUbicar = rows.filter((o) => !o[NIVELES[nivel].key]).length;
  paintStatus();
}

let lastSinUbicar = 0;
function paintStatus() {
  const n = lastSinUbicar;
  document.getElementById("map-status").textContent = n
    ? `${nf.format(n)} ${n === 1 ? "obra no se pudo ubicar" : "obras no se pudieron ubicar"} a nivel de ${NIVELES[state.nivel].label.toLowerCase()}`
    : "";
}

function renderLegend() {
  const el = document.getElementById("legend");
  const fmt = state.metrica === "saldo" ? solesCorto : (v) => nf.format(v);
  const tit = state.metrica === "saldo" ? "Falta ejecutar" : "Obras paralizadas";
  if (!breaks.length) { el.innerHTML = `<b>${tit}</b><span>Sin datos con estos filtros</span>`; return; }
  const items = [`<li><i style="background:${ZERO}"></i><span>Ninguna</span></li>`];
  RAMP.slice(0, breaks.length + 1).forEach((col, i) => {
    const label = i === 0 ? `hasta ${fmt(breaks[0])}` : i === breaks.length ? `más de ${fmt(breaks[i - 1])}` : `hasta ${fmt(breaks[i])}`;
    items.push(`<li><i style="background:${col}"></i><span>${label}</span></li>`);
  });
  el.innerHTML = `<b>${tit}</b><ol>${items.join("")}</ol>`;
}

// ---------- selección ----------
let prevSel = null;
function select(nivel, ubigeo, { fit = true } = {}) {
  if (prevSel) map.setFeatureState(prevSel, { sel: false });
  state.sel = ubigeo ? { nivel, ubigeo } : null;
  state.listLimit = PAGE;
  if (ubigeo) {
    if (state.nivel !== nivel) {
      state.nivel = nivel;
      document.querySelector(`input[name="nivel"][value="${nivel}"]`).checked = true;
      setLayerVisibility();
    }
    prevSel = { source: nivel, id: ubigeo };
    map.setFeatureState(prevSel, { sel: true });
    const z = ZONES[nivel].get(ubigeo);
    const box = z?.bbox || ZONES.provincia.get(ubigeo.slice(0, 4))?.bbox;
    if (fit && box) map.fitBounds(box, { padding: 60, maxZoom: nivel === "distrito" ? 9.5 : 8, duration: 700 });
  } else {
    prevSel = null;
    map.fitBounds([[-81.4, -18.4], [-68.6, -0.05]], { padding: 20, duration: 600 });
  }
  // La zona elegida queda en la URL para poder compartirla.
  history.replaceState(null, "", ubigeo ? `#zona=${nivel}/${ubigeo}` : location.pathname + location.search);
  render();
}

// ---------- render ----------
function render() {
  const rows = filtered();
  paintMap(rows);
  const scope = inSelection(rows);
  renderZone(scope);
  renderCausas(scope);
  renderCasi(scope);
  renderEntidades(scope);
  renderTipos(scope, H);
  renderTimeline(scope, H);
  renderGob(scope, H);
}

// Helpers que usan las secciones de sections.js.
let META = {};
const H = {
  state, nf, nf1, soles, solesCorto, anios, fecha, median, countTo, esc, titulo, reduced,
  get meta() { return META; },
  openObra: (i) => openObra(i),
  select: (n, u) => select(n, u),
  toast: (m) => toast(m),
  scope: () => inSelection(filtered()),
  miniSvg: (v) => miniSvg(v),
};

function obraItem(o, showPlace = true) {
  const place = showPlace ? [o.dist, o.prov, o.dep].filter(Boolean)[0] : "";
  return `<li><button type="button" data-i="${o._i}">
    <span class="o-name">${esc(o.nombre)}</span>
    <span class="o-amount">${solesCorto(o.saldo)}</span>
    <span class="o-meta"><span class="o-bar" aria-hidden="true"><i style="width:${o.avance ?? 0}%"></i></span>
      ${o.avance != null ? `${nf1.format(o.avance)}% de avance` : "Avance sin dato"}${place ? `, ${esc(place)}` : ""}</span>
  </button></li>`;
}

function renderZone(scope) {
  const sel = state.sel;
  const z = sel && ZONES[sel.nivel].get(sel.ubigeo);
  document.getElementById("zone-name").textContent = z ? z.nombre : "Perú";
  document.getElementById("zone-path").textContent = z
    ? `${NIVELES[sel.nivel].label}${z.padre ? `, ${z.padre}` : ""}${z.sinPoligono ? ". No tiene contorno en el mapa del INEI" : ""}`
    : "Todo el país";
  document.getElementById("zone-clear").hidden = !sel;

  const saldo = scope.reduce((s, o) => s + (o.saldo || 0), 0);
  const costo = scope.reduce((s, o) => s + (o.costo || 0), 0);
  countTo(document.getElementById("z-obras"), scope.length, (v) => nf.format(Math.round(v)));
  countTo(document.getElementById("z-saldo"), saldo, solesCorto);
  countTo(document.getElementById("z-costo"), costo, solesCorto);
  document.getElementById("z-anios").textContent = anios(median(scope.map((o) => o.anios)));

  const list = document.getElementById("zone-list");
  const sorted = [...scope].sort((a, b) => (b.saldo || 0) - (a.saldo || 0));
  list.innerHTML = sorted.length
    ? sorted.slice(0, state.listLimit).map((o) => obraItem(o, !sel || sel.nivel !== "distrito")).join("")
    : `<li class="empty-note">No hay obras paralizadas registradas aquí con estos filtros.</li>`;
  const more = document.getElementById("zone-more");
  more.hidden = sorted.length <= state.listLimit;
  more.textContent = `Ver ${Math.min(PAGE, sorted.length - state.listLimit)} obras más (de ${nf.format(sorted.length)})`;
}

function renderCausas(scope) {
  const m = new Map();
  for (const o of scope) {
    const a = m.get(o.causal) || { obras: 0, saldo: 0 };
    a.obras++; a.saldo += o.saldo || 0;
    m.set(o.causal, a);
  }
  const metric = state.metrica;
  const rows = [...m.entries()].sort((a, b) => b[1][metric] - a[1][metric]);
  const max = Math.max(1, ...rows.map((r) => r[1][metric]));
  const el = document.getElementById("bars-causal");
  el.innerHTML = rows.length ? rows.map(([k, a], i) => `
    <div class="bar-row" data-causal="${esc(k)}" tabindex="0">
      <span>${esc(k)}</span>
      <span class="bar-track" aria-hidden="true"><i style="width:${(a[metric] / max) * 100}%; transition-delay:${i * 45}ms"></i></span>
      <span class="bar-val">${metric === "saldo" ? solesCorto(a.saldo) : nf.format(a.obras)}</span>
    </div>`).join("") : `<p class="empty-note">Sin obras con estos filtros.</p>`;
  const z = state.sel && ZONES[state.sel.nivel].get(state.sel.ubigeo);
  document.getElementById("causas-note").textContent =
    `Causa declarada por la entidad ante la Contraloría${z ? `, en ${z.nombre}` : ""}. ${metric === "saldo" ? "Ordenado por dinero pendiente." : "Ordenado por número de obras."} Pasa el cursor para ver dónde pesa cada una; haz clic para filtrar el mapa.`;
}

function renderCasi(scope) {
  const casi = scope.filter((o) => (o.avance ?? 0) >= 90).sort((a, b) => (b.saldo || 0) - (a.saldo || 0)).slice(0, 8);
  document.getElementById("casi-list").innerHTML = casi.length
    ? casi.map((o) => obraItem(o)).join("")
    : `<li class="empty-note">Ninguna obra con 90% o más de avance en esta selección.</li>`;
}

function renderEntidades(scope) {
  const m = new Map();
  for (const o of scope) {
    if (!o.entidad) continue;
    const a = m.get(o.entidad) || { nivel: o.nivel, dep: o.dep, obras: 0, saldo: 0, casi: 0 };
    a.obras++; a.saldo += o.saldo || 0; if ((o.avance ?? 0) >= 90) a.casi++;
    m.set(o.entidad, a);
  }
  const k = state.entSort;
  const rows = [...m.entries()].sort((a, b) => b[1][k] - a[1][k] || b[1].saldo - a[1].saldo).slice(0, 15);
  document.getElementById("ent-body").innerHTML = rows.length ? rows.map(([k, a]) => `
    <tr data-entidad="${esc(k)}"><td>${esc(titulo(k))}<small>${esc(a.dep || "")}</small></td><td>${esc(a.nivel)}</td>
    <td class="num">${nf.format(a.obras)}</td><td class="num">${soles(a.saldo)}</td><td class="num">${nf.format(a.casi)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty-note">Sin entidades con estos filtros.</td></tr>`;
}

// ---------- detalle de obra ----------
let dialogObra = -1;
function openObra(i) {
  dialogObra = i;
  const o = OBRAS[i];
  const set = (id, v) => (document.getElementById(id).textContent = v);
  set("d-entidad", `${titulo(o.entidad || "Entidad sin dato")}. Gobierno ${String(o.nivel || "").toLowerCase()}`);
  set("d-nombre", o.nombre);
  set("d-lugar", [o.dist, o.prov, o.dep].filter(Boolean).join(", ") || "Sin dato");
  set("d-costo", soles(o.costo));
  set("d-saldo", soles(o.saldo));
  set("d-avance", o.avance != null ? `${nf1.format(o.avance)}%` : "Sin dato");
  document.getElementById("d-meter").style.width = `${o.avance ?? 0}%`;
  set("d-fecha", o.f_paral ? `${fecha(o.f_paral)} (${anios(o.anios)} al corte)` : "Sin dato");
  set("d-causal", o.causal || "Sin dato");
  set("d-modalidad", o.modalidad || "Sin dato");
  set("d-sector", o.sector || "Sin dato");
  set("d-id", o.id || "Sin dato");
  set("d-cui", o.cui || "Sin dato");
  const dlg = document.getElementById("obra-dialog");
  if (!dlg.open) dlg.showModal();
  else { dlg.classList.remove("swap"); void dlg.offsetWidth; dlg.classList.add("swap"); }
}

// ---------- búsqueda ----------
function initSearch() {
  const input = document.getElementById("q");
  const list = document.getElementById("q-list");
  const counts = { departamento: aggregate(OBRAS, "departamento"), provincia: aggregate(OBRAS, "provincia"), distrito: aggregate(OBRAS, "distrito") };
  const index = [];
  for (const nivel of Object.keys(NIVELES)) {
    for (const [ubigeo, z] of ZONES[nivel]) {
      index.push({ nivel, ubigeo, nombre: z.nombre, padre: z.padre, n: norm(z.nombre), obras: counts[nivel].get(ubigeo)?.obras || 0 });
    }
  }
  const rank = { departamento: 0, provincia: 1, distrito: 2 };
  let results = [], active = -1;

  function show() {
    const q = norm(input.value);
    if (q.length < 2) { close(); return; }
    results = index
      .filter((r) => r.n.includes(q))
      .sort((a, b) => (b.n.startsWith(q) - a.n.startsWith(q)) || (rank[a.nivel] - rank[b.nivel]) || a.n.localeCompare(b.n))
      .slice(0, 12);
    active = results.length ? 0 : -1;
    list.innerHTML = results.length
      ? results.map((r, i) => `<li role="option" id="q-${i}" aria-selected="${i === active}" data-i="${i}">
          <span>${esc(r.nombre)}${r.padre ? `, <span class="fine">${esc(r.padre)}</span>` : ""}</span>
          <small>${NIVELES[r.nivel].label}, ${r.obras ? `${nf.format(r.obras)} ${r.obras === 1 ? "obra" : "obras"}` : "sin obras"}</small></li>`).join("")
      : `<li class="empty">No encontramos ese lugar. Prueba sin tildes o con otro nombre.</li>`;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", active >= 0 ? `q-${active}` : "");
  }
  function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
  function choose(i) {
    const r = results[i];
    if (!r) return;
    input.value = r.nombre;
    close();
    document.getElementById("mapa").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    select(r.nivel, r.ubigeo);
  }
  function move(d) {
    if (!results.length) return;
    active = (active + d + results.length) % results.length;
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", i === active));
    input.setAttribute("aria-activedescendant", `q-${active}`);
    list.children[active].scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", show);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); choose(Number(li.dataset.i)); }
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

// ---------- controles ----------
function initControls() {
  const opts = (key) => [...new Set(OBRAS.map((o) => o[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const fill = (id, values) => document.getElementById(id).insertAdjacentHTML("beforeend", values.map((v) => `<option>${esc(v)}</option>`).join(""));
  fill("f-causal", opts("causal"));
  fill("f-sector", opts("sector"));
  fill("f-tipo", TIPOS.map((t) => t.id).filter((id) => OBRAS.some((o) => o.tipo === id)));

  const form = document.getElementById("controls");
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "nivel") {
      state.nivel = t.value;
      if (state.sel) { map.setFeatureState(prevSel, { sel: false }); state.sel = null; prevSel = null; }
      setLayerVisibility();
    } else if (t.name === "metrica") state.metrica = t.value;
    else if (t.name === "mitad") state.mitad = t.checked;
    else state[t.name] = t.value;
    state.listLimit = PAGE;
    render();
  });
  form.addEventListener("submit", (e) => e.preventDefault());

  document.getElementById("zone-clear").addEventListener("click", () => select(null, null));
  document.getElementById("zone-more").addEventListener("click", () => {
    state.listLimit += PAGE;
    renderZone(inSelection(filtered()));
  });
  document.body.addEventListener("click", (e) => {
    const b = e.target.closest(".obra-list button[data-i]");
    if (b) openObra(Number(b.dataset.i));
  });
  document.getElementById("obra-dialog").addEventListener("click", (e) => {
    if (e.target.id === "obra-dialog") e.target.close();
  });
  initHovers();
  document.getElementById("btn-azar").addEventListener("click", obraAlAzar);
  document.getElementById("d-otra").addEventListener("click", obraAlAzar);
  document.getElementById("d-ver").addEventListener("click", () => {
    const o = OBRAS[dialogObra];
    document.getElementById("obra-dialog").close();
    const nivel = o.u_dist && ZONES.distrito.get(o.u_dist)?.bbox ? "distrito" : o.u_prov ? "provincia" : "departamento";
    const id = nivel === "distrito" ? o.u_dist : nivel === "provincia" ? o.u_prov : o.u_dep;
    document.getElementById("mapa").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    select(nivel, id);
  });
  initZoneActions();
  initSort();
  init3D();
}

// ---------- mini mapa SVG por departamento (para las tarjetas flotantes) ----------
let MINI = null;
function miniMap() {
  if (MINI) return MINI;
  const W = 150, H = 210;
  const feats = GEO.departamento.features;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of feats) { const [[a, b], [c, d]] = ZONES.departamento.get(f.properties.ubigeo).bbox; x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); }
  const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
  const sc = Math.min(W / ((x1 - x0) * k), H / (y1 - y0));
  const pt = ([x, y]) => `${((x - x0) * k * sc).toFixed(1)},${((y1 - y) * sc).toFixed(1)}`;
  const ring = (r) => `M${r.map(pt).join("L")}Z`;
  const paths = feats.map((f) => {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return { id: f.properties.ubigeo, d: polys.map((p) => p.map(ring).join("")).join("") };
  });
  MINI = { W, H, paths };
  return MINI;
}
function miniSvg(values) {
  const { W, H, paths } = miniMap();
  const max = Math.max(1, ...values.values());
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${paths.map((p) => {
    // Sobre el fondo azul del cartel la intensidad va en ámbar: más dinero, más opaco.
    const v = values.get(p.id) || 0;
    const fill = v ? `rgba(233,162,26,${(0.35 + 0.65 * Math.sqrt(v / max)).toFixed(2)})` : "rgba(255,255,255,.1)";
    return `<path d="${p.d}" fill="${fill}" stroke="#0f3359" stroke-width=".6"/>`;
  }).join("")}</svg>`;
}

// ---------- hover: tarjeta de obra, causas y entidades ----------
function initHovers() {
  const peek = document.getElementById("peek");
  const fine = matchMedia("(pointer: fine)").matches;
  let current = -1;

  function showPeek(o, x, y) {
    if (!fine) return;
    if (current !== o._i) {
      current = o._i;
      peek.classList.remove("peek-wide");
      peek.innerHTML = `
        <span class="bolt tl"></span><span class="bolt tr"></span>
        <span class="p-k">${esc(titulo(o.entidad || ""))}</span>
        <span class="p-name">${esc(o.nombre)}</span>
        <span class="p-grid">
          <span><small>Costo</small>${solesCorto(o.costo)}</span>
          <span><small>Falta</small>${solesCorto(o.saldo)}</span>
          <span><small>Parada hace</small>${anios(o.anios)}</span>
        </span>
        <span class="p-meter"><i style="width:${o.avance ?? 0}%"></i></span>
        <span class="p-k">${o.avance != null ? `${nf1.format(o.avance)}% construida` : "Avance sin dato"}. ${esc(o.causal || "")}</span>`;
      peek.hidden = false;
      peek.classList.remove("is-in");
      void peek.offsetWidth;
      peek.classList.add("is-in");
    }
    const w = peek.offsetWidth, h = peek.offsetHeight;
    const px = x + 22 + w > innerWidth ? x - w - 22 : x + 22;
    const py = Math.min(Math.max(8, y - h / 2), innerHeight - h - 8);
    peek.style.transform = `translate(${px}px, ${py}px)`;
  }
  function hidePeek() { peek.hidden = true; peek.classList.remove("peek-wide"); current = -1; }

  document.body.addEventListener("pointermove", (e) => {
    const b = e.target.closest(".obra-list button[data-i]");
    if (b) {
      const o = OBRAS[Number(b.dataset.i)];
      showPeek(o, e.clientX, e.clientY);
      if (pulsed?.id !== o[NIVELES[state.nivel].key]) pulseZone(o);
    } else if (current >= 0) { hidePeek(); pulseZone(null); }
  });
  document.body.addEventListener("focusin", (e) => {
    const b = e.target.closest(".obra-list button[data-i]");
    if (b) pulseZone(OBRAS[Number(b.dataset.i)]);
  });

  // Causas y entidades: al pasar el cursor sale una tarjeta con un mini mapa
  // de dónde están esas obras, y el mapa grande deja encendidas solo sus zonas.
  const groupCard = (field, v, el, pt) => {
    if (!fine) return;
    const rows = inSelection(filtered()).filter((o) => o[field] === v);
    const porDep = new Map();
    for (const o of rows) if (o.u_dep) porDep.set(o.u_dep, (porDep.get(o.u_dep) || 0) + (o.saldo || 0));
    const top = [...porDep.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const saldo = rows.reduce((s, o) => s + (o.saldo || 0), 0);
    const av = median(rows.map((o) => o.avance));
    peek.innerHTML = `
      <span class="bolt tl"></span><span class="bolt tr"></span>
      <span class="p-k">${field === "causal" ? "Causa declarada" : esc(rows[0]?.nivel ? `Gobierno ${rows[0].nivel.toLowerCase()}` : "Entidad")}</span>
      <span class="p-name">${esc(field === "causal" ? v : titulo(v))}</span>
      <span class="p-split">
        ${miniSvg(porDep)}
        <span class="p-side">
          <span><small>Obras</small>${nf.format(rows.length)}</span>
          <span><small>Falta ejecutar</small>${solesCorto(saldo)}</span>
          <span><small>Avance mediano</small>${av != null ? `${nf1.format(av)}%` : "–"}</span>
          ${top.length ? `<span class="p-top"><small>Dónde pesa más</small>${top.map(([u, val]) => `${esc(ZONES.departamento.get(u)?.nombre || u)} <b>${solesCorto(val)}</b>`).join("<br>")}</span>` : ""}
        </span>
      </span>
      ${field === "causal" ? `<span class="p-k">Clic para filtrar el mapa por esta causa</span>` : ""}`;
    peek.hidden = false;
    peek.classList.add("peek-wide");
    peek.classList.remove("is-in"); void peek.offsetWidth; peek.classList.add("is-in");
    // Junto al cursor (o al elemento si llegó con teclado), sin salirse de la pantalla.
    const r = el.getBoundingClientRect();
    const ax = pt ? pt.x : r.left + 40, ay = pt ? pt.y : r.top + r.height / 2;
    const w = peek.offsetWidth, h = peek.offsetHeight;
    const px = ax + 24 + w < innerWidth ? ax + 24 : Math.max(8, ax - w - 24);
    const py = Math.min(Math.max(8, ay - h / 2), innerHeight - h - 8);
    peek.style.transform = `translate(${px}px, ${py}px)`;
    current = -2;
  };
  const hoverDim = (selector, attr, field) => {
    const root = document.querySelector(selector);
    let active = null;
    const on = (el, pt) => {
      const v = el.getAttribute(attr);
      if (v === active) return;
      active = v;
      root.querySelectorAll(`[${attr}]`).forEach((r) => r.classList.toggle("is-hot", r === el));
      dimExcept(zonesWhere((o) => o[field] === v));
      groupCard(field, v, el, pt);
      document.getElementById("map-status").textContent = `Mostrando en el mapa: ${field === "causal" ? v : titulo(v)}`;
    };
    const off = () => {
      if (active == null) return;
      active = null;
      root.querySelectorAll(".is-hot").forEach((r) => r.classList.remove("is-hot"));
      dimExcept(null);
      hidePeek();
      paintStatus();
    };
    root.addEventListener("pointerover", (e) => { const el = e.target.closest(`[${attr}]`); if (el) on(el, { x: e.clientX, y: e.clientY }); });
    root.addEventListener("pointerleave", off);
    root.addEventListener("focusin", (e) => { const el = e.target.closest(`[${attr}]`); if (el) on(el); });
    root.addEventListener("focusout", off);
  };
  hoverDim("#bars-causal", "data-causal", "causal");
  const filtrarCausa = (row) => {
    const sel = document.getElementById("f-causal");
    sel.value = row.dataset.causal;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    hidePeek();
    document.getElementById("mapa").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  };
  document.getElementById("bars-causal").addEventListener("click", (e) => { const r = e.target.closest("[data-causal]"); if (r) filtrarCausa(r); });
  document.getElementById("bars-causal").addEventListener("keydown", (e) => {
    const r = e.target.closest("[data-causal]");
    if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); filtrarCausa(r); }
  });
  hoverDim("#ent-body", "data-entidad", "entidad");
}

// ---------- portada ----------
function renderHero(resumen, meta) {
  // Las cifras del cartel se "decodifican" al cargar.
  const set = (k, v) => document.querySelectorAll(`[data-k="${k}"]`).forEach((el, i) => { el.setAttribute("aria-label", v); scramble(el, v, 1100 + i * 120); });
  set("obras", nf.format(resumen.obras));
  set("costo", soles(resumen.costo_actualizado));
  set("saldo", soles(resumen.saldo_por_ejecutar));
  set("mitad", nf.format(resumen.obras_mitad_o_mas));
  if (meta.corte) {
    const [y, m] = meta.corte.split("-").map(Number);
    set("corte_largo", `${MESES[m - 1]} de ${y}`);
  } else set("corte_largo", "fecha sin dato");

  document.getElementById("sample-tag").hidden = !meta.es_muestra;
  if (meta.url) document.getElementById("src-link").href = meta.url;
  document.getElementById("src-meta").textContent =
    `Archivo procesado: ${meta.archivo || "sin dato"}, ${nf.format(meta.filas || 0)} filas${meta.sha256 ? `, SHA-256 ${meta.sha256.slice(0, 12)}…` : ""}.`;
  const ubicadas = resumen.geo_distrito || 0;
  document.getElementById("geo-meta").textContent =
    `${nf.format(ubicadas)} de ${nf.format(resumen.obras)} obras se ubicaron a nivel de distrito; ${nf.format(resumen.geo_provincia || 0)} solo a nivel de provincia y ${nf.format((resumen.geo_departamento || 0) + (resumen.geo_sin_match || 0))} a nivel de departamento o sin ubicar.`;
}

// ---------- portada: historia con scroll sobre el mapa de puntos ----------
let DOTS = null;
function initStory() {
  const tip = document.getElementById("tooltip");
  DOTS = createDots({
    canvas: document.getElementById("dots"),
    obras: OBRAS,
    geo: GEO,
    fmtSoles: solesCorto,
    colors: {
      land: cssVar("--concreto-2"), border: "#f4f5f3", dot: cssVar("--cartel"), casi: cssVar("--ambar"),
      ring: cssVar("--grafito"), ink: cssVar("--grafito"), muted: cssVar("--gris"),
      font: "Barlow, system-ui, sans-serif", cond: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    },
    onHover(o, x, y) {
      const lugar = [o.dist, o.prov, o.dep].filter(Boolean).join(", ");
      tip.innerHTML = `<b>${esc(o.nombre.length > 90 ? o.nombre.slice(0, 88) + "…" : o.nombre)}</b>
        <span class="t-sub">${esc(lugar)}</span>
        <span class="t-row"><span>Falta ejecutar</span><strong>${solesCorto(o.saldo)}</strong></span>
        <span class="t-share"><i style="width:${o.avance ?? 0}%"></i></span>
        <span class="t-note">${o.avance != null ? `${nf1.format(o.avance)}% construida` : "Avance sin dato"}${o.anios != null ? `, parada hace ${anios(o.anios)}` : ""}. ${esc(o.causal || "")}. Clic para ver la ficha.</span>`;
      tip.hidden = false;
      tip.style.left = `${Math.min(x + 16, innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${Math.min(y + 16, innerHeight - tip.offsetHeight - 8)}px`;
    },
    onLeave() { tip.hidden = true; },
    onPick(o) { tip.hidden = true; openObra(o._i); },
  });

  // Cifras de cada paso, calculadas sobre todo el país.
  const all = OBRAS;
  const porCausa = new Map();
  for (const o of all) {
    const a = porCausa.get(o.causal) || { n: 0, saldo: 0 };
    a.n++; a.saldo += o.saldo || 0; porCausa.set(o.causal, a);
  }
  const causas = [...porCausa.entries()].sort((a, b) => b[1].saldo - a[1].saldo);
  const [top, segunda, tercera] = causas;
  const med = median(all.map((o) => o.anios));
  const casi = all.filter((o) => (o.avance ?? 0) >= 90);
  const saldoTotal = all.reduce((s, o) => s + (o.saldo || 0), 0) || 1;
  const saldoCasi = casi.reduce((s, o) => s + (o.saldo || 0), 0);
  const mas3 = all.filter((o) => (o.anios ?? 0) > 3).length;
  const S = {
    obras: nf.format(all.length),
    mitad: nf.format(all.filter((o) => (o.avance ?? 0) >= 50).length),
    topcausa: `"${(top?.[0] || "").toLowerCase()}"`,
    causa_det: top ? `${nf.format(top[1].n)} obras y ${soles(top[1].saldo)} pendientes. Le siguen ${(segunda?.[0] || "").toLowerCase()} y ${(tercera?.[0] || "").toLowerCase()}.` : "",
    mediana: anios(med),
    tiempo_det: `${nf.format(mas3)} obras pasan los tres años sin ningún avance. A la derecha del gráfico están las más antiguas.`,
    casi: nf.format(casi.length),
    casi_det: `Terminarlas costaría ${soles(saldoCasi)}: el ${nf1.format((saldoCasi / saldoTotal) * 100)}% de todo lo que falta ejecutar. Son las que más rápido se podrían destrabar.`,
  };
  document.querySelectorAll("[data-s]").forEach((el) => (el.textContent = S[el.dataset.s] ?? ""));

  const HL = {
    mitad: (o) => (o.avance ?? 0) >= 50,
    topcausa: (o) => o.causal === top?.[0],
    mediana: (o) => (o.anios ?? 0) > (med ?? 0),
    casi: (o) => (o.avance ?? 0) >= 90,
  };
  const tabs = [...document.querySelectorAll(".mode-tabs [data-mode]")];
  const setTabs = (mode) => tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.mode === mode)));
  const go = (mode, hl) => { DOTS.setMode(mode, hl ? HL[hl] : null); setTabs(mode); };

  tabs.forEach((t) => t.addEventListener("click", () => go(t.dataset.mode, null)));
  // Flechas izquierda/derecha entre pestañas.
  document.querySelector(".mode-tabs").addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    n.focus(); n.click();
  });

  const steps = [...document.querySelectorAll(".story-step")];
  // En celular el gráfico ocupa la mitad de arriba: el paso se activa al entrar en la mitad de abajo.
  const narrow = matchMedia("(max-width: 1020px)").matches;
  scrollSteps(steps, (i) => go(steps[i].dataset.mode, steps[i].dataset.hl), narrow ? "-72% 0px -24% 0px" : undefined);
}

// ---------- obra al azar ----------
function obraAlAzar() {
  const conDinero = OBRAS.filter((o) => (o.saldo || 0) > 0);
  const o = conDinero[Math.floor(Math.random() * conDinero.length)];
  openObra(o._i);
}

// ---------- cinta de obras ----------
function initTicker() {
  const track = document.getElementById("ticker-track");
  const top = [...OBRAS].sort((a, b) => (b.saldo || 0) - (a.saldo || 0)).slice(0, 30);
  const item = (o) => `<button type="button" class="ticker-item" data-i="${o._i}">
    <span>${esc(o.nombre.length > 64 ? o.nombre.slice(0, 62) + "…" : o.nombre)}</span>
    <small>${esc(o.dist || o.prov || o.dep || "")}</small><b>${solesCorto(o.saldo)}</b>
    <small>${o.anios != null ? `parada hace ${anios(o.anios)}` : ""}</small></button>`;
  // Dos copias seguidas para que el bucle no tenga corte.
  track.innerHTML = top.map(item).join("") + `<span aria-hidden="true" style="display:contents">${top.map(item).join("")}</span>`;
  track.querySelectorAll("[aria-hidden] button").forEach((b) => (b.tabIndex = -1));
  track.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) openObra(Number(b.dataset.i)); });
  if (reduced) { document.getElementById("ticker").style.overflowX = "auto"; return; }

  const anim = track.animate([{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }], { duration: top.length * 3200, iterations: Infinity });
  // El scroll la acelera; al soltar vuelve a su ritmo. Con el cursor encima se detiene.
  let lastY = scrollY, boost = 0, paused = false, raf = 0;
  const loop = () => {
    boost *= 0.92;
    if (!paused) anim.playbackRate = 1 + boost;
    raf = boost > 0.02 ? requestAnimationFrame(loop) : 0;
    if (!raf && !paused) anim.playbackRate = 1;
  };
  addEventListener("scroll", () => {
    const v = Math.abs(scrollY - lastY); lastY = scrollY;
    boost = Math.min(8, boost + v / 25);
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
  const ticker = document.getElementById("ticker");
  ticker.addEventListener("pointerenter", () => { paused = true; anim.playbackRate = 0; });
  ticker.addEventListener("pointerleave", () => { paused = false; anim.playbackRate = 1; });
  ticker.addEventListener("focusin", () => { paused = true; anim.playbackRate = 0; });
  ticker.addEventListener("focusout", () => { paused = false; anim.playbackRate = 1; });
}

// ---------- navegación lateral ----------
function initSideNav() {
  const links = [...document.querySelectorAll("#side-nav a")];
  const targets = { top: document.querySelector(".story") };
  for (const id of ["mapa", "tipos", "causas", "records", "comparar", "entidades", "faq", "metodo"]) targets[id] = document.getElementById(id);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const key = Object.keys(targets).find((k) => targets[k] === e.target);
      links.forEach((a) => a.classList.toggle("is-active", a.dataset.sec === key));
      document.body.classList.toggle("pipe-active", key === "metodo");
    }
  }, { rootMargin: "-50% 0px -50% 0px" });
  Object.values(targets).forEach((t) => t && io.observe(t));
}

// ---------- aviso breve ----------
let toastT = 0;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.hidden = true), 2200);
}

// ---------- compartir y descargar ----------
function initZoneActions() {
  document.getElementById("btn-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast(state.sel ? "Enlace a esta zona copiado" : "Enlace copiado");
    } catch {
      toast("No se pudo copiar. Copia la dirección del navegador.");
    }
  });
  document.getElementById("btn-csv").addEventListener("click", () => {
    const rows = inSelection(filtered());
    const cols = [["id", "codigo_infobras"], ["cui", "cui"], ["nombre", "nombre_obra"], ["entidad", "entidad"], ["nivel", "nivel_gobierno"],
      ["dep", "departamento"], ["prov", "provincia"], ["dist", "distrito"], ["sector", "sector"], ["causal", "causal_paralizacion"],
      ["costo", "costo_actualizado"], ["ejecutado", "monto_ejecutado"], ["saldo", "saldo_por_ejecutar"], ["avance", "avance_fisico"],
      ["f_paral", "fecha_paralizacion"], ["anios", "anios_paralizada"]];
    const q = (v) => (v == null ? "" : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = "\ufeff" + [cols.map((c) => c[1]).join(","), ...rows.map((o) => cols.map(([k]) => q(o[k])).join(","))].join("\n");
    const z = state.sel && ZONES[state.sel.nivel].get(state.sel.ubigeo);
    const name = `obras-paralizadas-${norm(z ? z.nombre : "peru").replace(/\s+/g, "-")}.csv`;
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${nf.format(rows.length)} obras descargadas en ${name}`);
  });
}

function selectFromHash() {
  const m = location.hash.match(/^#zona=(departamento|provincia|distrito)\/(\d{2,6})$/);
  if (m && ZONES[m[1]].has(m[2])) {
    select(m[1], m[2]);
    setTimeout(() => document.getElementById("mapa").scrollIntoView(), 50);
  }
}

// ---------- ordenar entidades ----------
function initSort() {
  document.querySelector(".ent-table thead").addEventListener("click", (e) => {
    const b = e.target.closest(".sort");
    if (!b) return;
    state.entSort = b.dataset.sort;
    document.querySelectorAll(".ent-table th[aria-sort]").forEach((th) => th.setAttribute("aria-sort", th.querySelector(".sort").dataset.sort === state.entSort ? "descending" : "none"));
    const body = document.getElementById("ent-body");
    renderEntidades(inSelection(filtered()));
    body.classList.remove("sorting"); void body.offsetWidth; body.classList.add("sorting");
  });
}

// ---------- mapa 3D ----------
function init3D() {
  const btn = document.getElementById("btn-3d");
  btn.addEventListener("click", () => {
    state.tresD = !state.tresD;
    btn.setAttribute("aria-pressed", String(state.tresD));
    btn.lastChild.textContent = state.tresD ? " Volver a 2D" : " Ver en 3D";
    document.querySelector(".map-wrap").classList.toggle("is-3d", state.tresD);
    setLayerVisibility();
    if (state.tresD) { map.dragRotate.enable(); map.easeTo({ pitch: 55, bearing: -18, zoom: map.getZoom() - 0.35, duration: reduced ? 0 : 1400 }); }
    else { map.easeTo({ pitch: 0, bearing: 0, zoom: map.getZoom() + 0.35, duration: reduced ? 0 : 900 }); map.dragRotate.disable(); }
  });
}

// ---------- terminal del pipeline ----------
// Las líneas salen de meta.json y resumen.json: es la salida real de la última carga.
function pipelineLines(meta, resumen) {
  const sha = meta.sha256 ? meta.sha256.slice(0, 16) : "sin dato";
  const corte = meta.corte || "AAAA-MM";
  const cols = Object.entries(meta.columnas || {});
  const pad = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t.padEnd(n, " "));
  const dbt = meta.dbt;
  const t = dbt?.tests || {};
  return [
    [
      { t: "$ python -m pipeline.cli ingest", c: "cmd" },
      { t: "buscando \"obras paralizadas en el territorio nacional\" en gob.pe", c: "dim" },
      { t: meta.publicacion ? `publicación: ${meta.publicacion}` : "fuente: archivo local (--file)", c: "" },
      { t: `corte del informe: ${corte}`, c: "" },
      { t: `descargado ${meta.archivo || "anexo02.xlsx"}`, c: "ok" },
      { t: `sha256 ${sha}…`, c: "dim" },
      { t: "comparando con la última carga publicada… archivo nuevo", c: "dim" },
    ],
    [
      { t: `$ parse_excel("${meta.archivo || "anexo02.xlsx"}")`, c: "cmd" },
      { t: `hoja "${meta.hoja}", cabecera en la fila ${(meta.fila_cabecera ?? 0) + 1}`, c: "" },
      ...cols.slice(0, 9).map(([k, v]) => ({ t: innerWidth < 640 ? `  "${k}" -> ${v}` : `  ${pad(`"${k}"`, 30)} -> ${v}`, c: "map" })),
      ...(cols.length > 9 ? [{ t: `  … y ${cols.length - 9} columnas más`, c: "dim" }] : []),
      ...((meta.columnas_no_mapeadas || []).length ? [{ t: `  sin mapear: ${meta.columnas_no_mapeadas.join(", ")}`, c: "dim" }] : []),
      { t: `${nf.format(meta.filas || 0)} obras leídas -> data/staging/obras.parquet`, c: "ok" },
    ],
    [
      { t: `$ dbt build --vars '{fecha_corte: "${corte}"}'`, c: "cmd" },
      { t: `seeds: ${dbt?.seeds ?? 2} (ubigeo INEI, departamentos)`, c: "dim" },
      ...(dbt?.modelos || []).map((m) => ({ t: `  OK  ${pad(m.nombre, 16)} ${m.segundos.toFixed(2)}s`, c: "ok" })),
      { t: `tests: PASS=${t.pass ?? 0} WARN=${t.warn ?? 0} ERROR=${(t.error ?? 0) + (t.fail ?? 0)}`, c: (t.error || t.fail) ? "err" : "ok" },
      { t: `ubicadas en su distrito: ${nf.format(resumen.geo_distrito || 0)} de ${nf.format(resumen.obras)}`, c: "" },
      { t: `solo a nivel de provincia: ${nf.format(resumen.geo_provincia || 0)}`, c: "dim" },
    ],
    [
      { t: "$ python -m pipeline.cli export", c: "cmd" },
      { t: `web/data/obras.json    ${nf.format(resumen.obras)} filas`, c: "ok" },
      { t: "web/data/resumen.json  cifras de portada", c: "ok" },
      { t: "web/data/meta.json     procedencia y hash", c: "ok" },
      { t: `$ git commit -m "datos: corte ${corte}" && git push`, c: "cmd" },
      { t: "netlify: deploy publicado", c: "ok" },
    ],
  ];
}

function initPipeline(meta, resumen) {
  const term = makeTerminal(document.getElementById("term-body"));
  const titles = ["ingest", "parse", "dbt build", "export"];
  const flow = [...document.querySelectorAll("#flow li")];
  const lines = pipelineLines(meta, resumen);
  scrollSteps([...document.querySelectorAll(".pipe .step")], (i) => {
    document.getElementById("term-title").textContent = `obra-parada: ${titles[i]}`;
    flow.forEach((li, j) => { li.classList.toggle("is-done", j < i); li.classList.toggle("is-active", j === i); });
    term.play(lines[i]);
  });
}

// ---------- arranque ----------
(async function main() {
  try {
    readingProgress(document.getElementById("progress-bar"));
    const { resumen, meta } = await load();
    META = meta;
    renderHero(resumen, meta);
    initStory();
    initTicker();
    await initMap();
    initControls();
    initSearch();
    render();
    selectFromHash();
    initSideNav();
    buildInMap();
    decodeOnView("h2.decode");
    revealOnView(".bars, .obra-list.compact, .ent-table, .zone-stats, .timeline, .gob, .rec-grid, .tipo-grid, .mod-table");
    bindTipos(H);
    renderRecords(OBRAS, H);
    initCompare(OBRAS, H);
    document.querySelector(".tl-switch").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tl]");
      if (!b) return;
      state.tlMetric = b.dataset.tl;
      document.querySelectorAll(".tl-switch [data-tl]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderTimeline(inSelection(filtered()), H);
    });
    initPipeline(meta, resumen);
  } catch (err) {
    console.error(err);
    document.getElementById("map-status").textContent = `No se pudieron cargar los datos: ${err.message}. Recarga la página.`;
  }
})();
