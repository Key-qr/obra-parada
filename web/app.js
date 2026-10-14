// Obra Parada: todo se calcula en el navegador a partir de data/*.json.
// Sin backend: los filtros recalculan agregados sobre ~2,500 filas al vuelo.

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
  gob: "", causal: "", sector: "", mitad: false,
  sel: null,          // { nivel, ubigeo }
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
  OBRAS.forEach((o, i) => (o._i = i));

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
        paint: { "fill-color": ZERO, "fill-opacity": 1 },
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
    tip.innerHTML = `<b>${esc(z?.nombre)}</b>${z?.padre ? `<span>${esc(z.padre)}</span><br>` : ""}${
      st.obras ? `${nf.format(st.obras)} ${st.obras === 1 ? "obra" : "obras"}, falta ejecutar ${soles(st.saldo)}` : "Sin obras paralizadas con estos filtros"}`;
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

function setLayerVisibility() {
  for (const nivel of Object.keys(NIVELES)) {
    const vis = nivel === state.nivel ? "visible" : "none";
    ["fill", "line", "sel"].forEach((t) => map.setLayoutProperty(`${nivel}-${t}`, "visibility", vis));
  }
}

function paintMap(rows) {
  const nivel = state.nivel;
  const agg = aggregate(rows, nivel);
  const metric = state.metrica;
  breaks = quantileBreaks([...agg.values()].map((a) => a[metric]));
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
      obras: a?.obras || 0, saldo: a?.saldo || 0, c: colorOf(a?.[metric] || 0),
    });
  }
  const expr = ["match", ["coalesce", ["feature-state", "c"], 0], 0, ZERO];
  RAMP.forEach((col, i) => expr.push(i + 1, col));
  expr.push(ZERO);
  map.setPaintProperty(`${nivel}-fill`, "fill-color", expr);
  renderLegend();

  const sinUbicar = rows.filter((o) => !o[NIVELES[nivel].key]).length;
  document.getElementById("map-status").textContent = sinUbicar
    ? `${nf.format(sinUbicar)} ${sinUbicar === 1 ? "obra no se pudo ubicar" : "obras no se pudieron ubicar"} a nivel de ${NIVELES[nivel].label.toLowerCase()}`
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
}

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
  document.getElementById("z-obras").textContent = nf.format(scope.length);
  document.getElementById("z-saldo").textContent = solesCorto(saldo);
  document.getElementById("z-costo").textContent = solesCorto(costo);
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
  el.innerHTML = rows.length ? rows.map(([k, a]) => `
    <div class="bar-row">
      <span>${esc(k)}</span>
      <span class="bar-track" aria-hidden="true"><i style="width:${(a[metric] / max) * 100}%"></i></span>
      <span class="bar-val">${metric === "saldo" ? solesCorto(a.saldo) : nf.format(a.obras)}</span>
    </div>`).join("") : `<p class="empty-note">Sin obras con estos filtros.</p>`;
  const z = state.sel && ZONES[state.sel.nivel].get(state.sel.ubigeo);
  document.getElementById("causas-note").textContent =
    `Causa declarada por la entidad ante la Contraloría${z ? `, en ${z.nombre}` : ""}. ${metric === "saldo" ? "Ordenado por dinero pendiente." : "Ordenado por número de obras."}`;
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
  const rows = [...m.entries()].sort((a, b) => b[1].saldo - a[1].saldo).slice(0, 15);
  document.getElementById("ent-body").innerHTML = rows.length ? rows.map(([k, a]) => `
    <tr><td>${esc(titulo(k))}<small>${esc(a.dep || "")}</small></td><td>${esc(a.nivel)}</td>
    <td class="num">${nf.format(a.obras)}</td><td class="num">${soles(a.saldo)}</td><td class="num">${nf.format(a.casi)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty-note">Sin entidades con estos filtros.</td></tr>`;
}

// ---------- detalle de obra ----------
function openObra(i) {
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
  document.getElementById("obra-dialog").showModal();
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
}

// ---------- portada ----------
function renderHero(resumen, meta) {
  const set = (k, v) => document.querySelectorAll(`[data-k="${k}"]`).forEach((el) => (el.textContent = v));
  set("obras", nf.format(resumen.obras));
  set("costo", soles(resumen.costo_actualizado));
  set("saldo", soles(resumen.saldo_por_ejecutar));
  set("mitad", nf.format(resumen.obras_mitad_o_mas));
  if (meta.corte) {
    const [y, m] = meta.corte.split("-").map(Number);
    set("corte_largo", `${MESES[m - 1]} de ${y}`);
  } else set("corte_largo", "fecha sin dato");

  document.getElementById("sample-bar").hidden = !meta.es_muestra;
  if (meta.url) document.getElementById("src-link").href = meta.url;
  document.getElementById("src-meta").textContent =
    `Archivo procesado: ${meta.archivo || "sin dato"}, ${nf.format(meta.filas || 0)} filas${meta.sha256 ? `, SHA-256 ${meta.sha256.slice(0, 12)}…` : ""}.`;
  const ubicadas = resumen.geo_distrito || 0;
  document.getElementById("geo-meta").textContent =
    `${nf.format(ubicadas)} de ${nf.format(resumen.obras)} obras se ubicaron a nivel de distrito; ${nf.format(resumen.geo_provincia || 0)} solo a nivel de provincia y ${nf.format((resumen.geo_departamento || 0) + (resumen.geo_sin_match || 0))} a nivel de departamento o sin ubicar.`;
}

// ---------- arranque ----------
(async function main() {
  try {
    const { resumen, meta } = await load();
    renderHero(resumen, meta);
    await initMap();
    initControls();
    initSearch();
    render();
  } catch (err) {
    console.error(err);
    document.getElementById("map-status").textContent = `No se pudieron cargar los datos: ${err.message}. Recarga la página.`;
  }
})();
