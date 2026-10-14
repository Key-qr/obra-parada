// Servicios de control (Anexo N.° 02). Vista aparte en #control; se arma la
// primera vez que se abre y después solo se vuelve a filtrar.
import { revealOnView, decodeOnView, countTo } from "./motion.js";

const SPIC = "http://apps8.contraloria.gob.pe/SPIC/srvDownload/ViewPDF?CRES_CODIGO=";
const PAGE = 20;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// export.py guarda "spic:CODIGO" cuando el PDF sigue el patrón del SPIC.
export function pdfUrls(c) {
  if (c.url && c.url.startsWith("spic:")) {
    const code = encodeURIComponent(c.url.slice(5));
    return { informe: `${SPIC}${code}&TIPOARCHIVO=ADJUNTO`, resumen: `${SPIC}${code}&TIPOARCHIVO=RE` };
  }
  return { informe: c.url, resumen: c.url_res };
}

const f = { q: "", dep: "", tipo: "", accion: "", anio: "", obra: "" };
let ROWS = [];
let H = null;
let limit = PAGE;
let ready = false;

export function initControl(h) {
  if (ready) return;
  ready = true;
  H = h;
  const { nf, esc } = h;
  ROWS = h.control.map((c) => {
    const o = h.obraPorId(c.id);
    return { ...c, o, _q: norm([c.titulo, c.servicio, c.num, c.entidad, c.organo, o?.nombre, c.id].join(" ")) };
  });

  // ---- cifras de arriba ----
  const conCtrl = new Set(ROWS.map((c) => c.id));
  const total = H.obras.length;
  const conPdf = ROWS.filter((c) => c.url).length;
  countTo(document.getElementById("c-total"), ROWS.length, (v) => nf.format(Math.round(v)), 1100);
  countTo(document.getElementById("c-obras"), conCtrl.size, (v) => nf.format(Math.round(v)), 1100);
  countTo(document.getElementById("c-sin"), total - conCtrl.size, (v) => nf.format(Math.round(v)), 1100);
  countTo(document.getElementById("c-pdf"), conPdf, (v) => nf.format(Math.round(v)), 1100);
  const anios = ROWS.map((c) => c.anio).filter(Boolean);
  document.getElementById("c-rango").textContent =
    `Emitidos entre ${Math.min(...anios)} y ${Math.max(...anios)}. ${nf.format(conCtrl.size)} de las ${nf.format(total)} obras paralizadas tuvieron al menos uno; ${nf.format(ROWS.length - conPdf)} servicios no tienen el informe enlazado.`;

  // ---- tipo de control y tipo de acción ----
  barras("c-bars-tipo", contar(ROWS, "tipo"), "tipo");
  barras("c-bars-accion", contar(ROWS, "accion").slice(0, 8), "accion");

  // ---- por año ----
  const porAnio = contar(ROWS, "anio").filter(([y]) => y).sort((a, b) => a[0] - b[0]);
  const max = Math.max(...porAnio.map(([, n]) => n));
  const pico = porAnio.reduce((a, b) => (b[1] > a[1] ? b : a));
  document.getElementById("c-anios").innerHTML = `<div class="tl-cols">${porAnio.map(([y, n], i) => `
    <button type="button" class="tl-col${y === pico[0] ? " is-peak" : ""}" data-anio="${y}" aria-label="${y}: ${nf.format(n)} servicios. Filtrar los informes">
      <span class="tl-val">${nf.format(n)}</span>
      <span class="tl-bar"><i style="height:${(n / max) * 100}%; transition-delay:${i * 35}ms"></i></span>
      <span class="tl-y">${porAnio.length > 9 ? "’" + String(y).slice(2) : y}</span>
    </button>`).join("")}</div>`;
  document.getElementById("c-anio-note").textContent =
    `El año con más servicios fue ${pico[0]} (${nf.format(pico[1])}). Clic en una columna para ver los de ese año.`;

  // ---- quién hizo el control ----
  const org = contar(ROWS, "organo_tipo");
  document.getElementById("c-organo").innerHTML = org.map(([k, n]) => `
    <div class="gob-row">
      <span class="gob-name">${esc(k === "Organo de control institucional" ? "Órgano de control de la entidad (OCI)" : k === "Contraloria general" ? "La Contraloría directamente" : k)}</span>
      <span class="gob-bars"><span class="gob-line"><small>Servicios</small><span class="gob-track"><i style="width:${(n / ROWS.length) * 100}%"></i></span><b>${H.nf1.format((n / ROWS.length) * 100)}%</b></span></span>
    </div>`).join("");

  // ---- obras más revisadas / mucho dinero sin control ----
  const masRev = [...H.obras].filter((o) => o.nctrl).sort((a, b) => b.nctrl - a.nctrl || (b.saldo || 0) - (a.saldo || 0)).slice(0, 8);
  document.getElementById("c-top").innerHTML = masRev.map((o) => `<li><button type="button" data-obra="${esc(o.id)}">
    <span class="o-name">${esc(o.nombre)}</span>
    <span class="o-amount">${nf.format(o.nctrl)}</span>
    <span class="o-meta">${esc([o.dist, o.dep].filter(Boolean).join(", "))}. Falta ejecutar ${H.solesCorto(o.saldo)}</span>
  </button></li>`).join("");
  const sinCtrl = [...H.obras].filter((o) => !o.nctrl).sort((a, b) => (b.saldo || 0) - (a.saldo || 0)).slice(0, 8);
  document.getElementById("c-sin-list").innerHTML = sinCtrl.map((o) => `<li><button type="button" data-i="${o._i}">
    <span class="o-name">${esc(o.nombre)}</span>
    <span class="o-amount">${H.solesCorto(o.saldo)}</span>
    <span class="o-meta"><span class="o-bar" aria-hidden="true"><i style="width:${o.avance ?? 0}%"></i></span>${o.avance != null ? `${H.nf1.format(o.avance)}% de avance` : "Avance sin dato"}, ${esc(o.dep || "")}</span>
  </button></li>`).join("");

  // ---- explorador ----
  const opts = (id, vals, fmt = (v) => v) => document.getElementById(id).insertAdjacentHTML("beforeend", vals.map((v) => `<option value="${esc(v)}">${esc(fmt(v))}</option>`).join(""));
  const deps = [...new Set(ROWS.map((c) => c.o?.dep).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  opts("c-f-dep", deps);
  opts("c-f-tipo", contar(ROWS, "tipo").map(([k]) => k));
  opts("c-f-accion", contar(ROWS, "accion").map(([k]) => k));
  opts("c-f-anio", porAnio.map(([y]) => y).reverse());

  const form = document.getElementById("c-form");
  let t = 0;
  form.addEventListener("input", (e) => {
    const el = e.target;
    const key = el.name;
    if (!(key in f)) return;
    f[key] = el.value;
    clearTimeout(t);
    t = setTimeout(() => { limit = PAGE; renderList(); }, el.type === "search" ? 160 : 0);
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("c-reset").addEventListener("click", () => setFiltros({}));
  document.getElementById("c-more").addEventListener("click", () => { limit += PAGE; renderList(false); });

  // Clic en barras, columnas, chips y obras: filtran el explorador y bajan a él.
  const view = document.getElementById("control");
  view.addEventListener("click", (e) => {
    const bar = e.target.closest("[data-cf]");
    const col = e.target.closest("[data-anio]");
    const obra = e.target.closest("[data-obra]");
    const chip = e.target.closest("[data-quitar]");
    const ficha = e.target.closest("[data-ficha]");
    if (bar) setFiltros({ [bar.dataset.cf]: bar.dataset.v }, true);
    else if (col) setFiltros({ anio: col.dataset.anio }, true);
    else if (obra) setFiltros({ obra: obra.dataset.obra }, true);
    else if (chip) { f[chip.dataset.quitar] = ""; syncForm(); limit = PAGE; renderList(); }
    else if (ficha) H.openObra(Number(ficha.dataset.ficha));
  });
  view.addEventListener("keydown", (e) => {
    const bar = e.target.closest("[data-cf]");
    if (bar && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); bar.click(); }
  });

  renderList();
  decodeOnView("#control h2.decode");
  revealOnView("#control .bars, #control .timeline, #control .gob, #control .obra-list.compact");
}

function contar(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function barras(id, rows, campo) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  document.getElementById(id).innerHTML = rows.map(([k, n], i) => `
    <div class="bar-row" data-cf="${campo}" data-v="${H.esc(k)}" tabindex="0" role="button" aria-label="${H.esc(k)}: ${H.nf.format(n)} servicios. Filtrar">
      <span>${H.esc(k)}</span>
      <span class="bar-track" aria-hidden="true"><i style="width:${(n / max) * 100}%; transition-delay:${i * 45}ms"></i></span>
      <span class="bar-val">${H.nf.format(n)}</span>
    </div>`).join("");
}

function syncForm() {
  for (const k of ["q", "dep", "tipo", "accion", "anio"]) document.querySelector(`#c-form [name="${k}"]`).value = f[k];
}

// Cambia filtros (los que no se pasan se limpian) y opcionalmente baja al explorador.
export function setFiltros(next, scroll = false) {
  if (!ready) return;
  Object.keys(f).forEach((k) => (f[k] = next[k] != null ? String(next[k]) : ""));
  syncForm();
  limit = PAGE;
  renderList();
  if (scroll) document.getElementById("c-explorar").scrollIntoView({ behavior: H.reduced ? "auto" : "smooth" });
}

function filtrados() {
  const q = norm(f.q).trim().split(/\s+/).filter(Boolean);
  return ROWS.filter((c) =>
    (!f.obra || String(c.id) === f.obra) &&
    (!f.dep || c.o?.dep === f.dep) &&
    (!f.tipo || c.tipo === f.tipo) &&
    (!f.accion || c.accion === f.accion) &&
    (!f.anio || String(c.anio) === f.anio) &&
    q.every((w) => c._q.includes(w))
  );
}

function renderList(reset = true) {
  const { nf, esc, titulo } = H;
  const rows = filtrados();
  const ul = document.getElementById("c-list");
  const desde = reset ? 0 : ul.children.length;
  const item = (c, i) => {
    const u = pdfUrls(c);
    const tit = c.titulo || c.servicio || "Servicio sin título";
    const serv = c.titulo && c.servicio && !parecidos(c.servicio, c.titulo) ? c.servicio : "";
    return `<li class="c-item" style="--d:${Math.min(i, 10) * 40}ms">
      <p class="c-top"><span class="c-anio">${c.anio ?? "s/f"}</span><span>${esc(c.tipo)}</span><span class="c-acc">${esc(c.accion)}</span></p>
      <h3 class="c-tit">${esc(tit)}</h3>
      ${serv ? `<p class="c-serv">${esc(serv)}</p>` : ""}
      <p class="c-meta">${c.num ? `Informe ${esc(c.num)}. ` : ""}Lo hizo: ${esc(titulo(c.organo || "sin dato"))}.</p>
      ${c.o ? `<button type="button" class="c-obra" data-ficha="${c.o._i}"><small>Obra</small>${esc(c.o.nombre.length > 140 ? c.o.nombre.slice(0, 138) + "…" : c.o.nombre)}<small>${esc([c.o.dist, c.o.dep].filter(Boolean).join(", "))}</small></button>` : `<p class="c-meta">Obra con código Infobras ${esc(c.id)}</p>`}
      <p class="c-links">${u.informe ? `<a class="btn btn-sm btn-solid" href="${esc(u.informe)}" target="_blank" rel="noopener">Informe (PDF)</a>` : `<span class="fine">Sin informe enlazado</span>`}
        ${u.resumen ? `<a class="btn btn-sm" href="${esc(u.resumen)}" target="_blank" rel="noopener">Resumen</a>` : ""}</p>
    </li>`;
  };
  const html = rows.slice(desde, limit).map((c, i) => item(c, i)).join("");
  if (reset) ul.innerHTML = html || `<li class="empty-note">Ningún servicio de control con estos filtros.</li>`;
  else ul.insertAdjacentHTML("beforeend", html);

  const more = document.getElementById("c-more");
  more.hidden = rows.length <= limit;
  more.textContent = `Ver ${Math.min(PAGE, rows.length - limit)} más (de ${nf.format(rows.length)})`;

  // Chips de lo que está filtrando ahora.
  const nombres = { dep: "Departamento", tipo: "Tipo", accion: "Acción", anio: "Año", q: "Texto" };
  const chips = [];
  if (f.obra) {
    const o = H.obraPorId(f.obra);
    chips.push(`<button type="button" class="c-chip" data-quitar="obra">Obra: ${esc(o ? (o.nombre.length > 60 ? o.nombre.slice(0, 58) + "…" : o.nombre) : f.obra)} <span aria-hidden="true">×</span><span class="sr">Quitar filtro</span></button>`);
  }
  for (const k of Object.keys(nombres)) if (f[k]) chips.push(`<button type="button" class="c-chip" data-quitar="${k}">${nombres[k]}: ${esc(f[k])} <span aria-hidden="true">×</span><span class="sr">Quitar filtro</span></button>`);
  document.getElementById("c-chips").innerHTML = chips.join("");
  document.getElementById("c-count").textContent =
    `${nf.format(rows.length)} ${rows.length === 1 ? "servicio de control" : "servicios de control"}${chips.length ? " con estos filtros" : " en total"}.`;
  document.getElementById("c-reset").hidden = !chips.length;
}

// El nombre del servicio muchas veces repite el título del informe con otras
// palabras al inicio o al final; si comparten un tramo largo, se muestra uno solo.
function parecidos(a, b) {
  const x = norm(a).replace(/[^a-z0-9]+/g, " ").trim(), y = norm(b).replace(/[^a-z0-9]+/g, " ").trim();
  if (!x || !y) return false;
  const corto = x.length < y.length ? x : y, largo = corto === x ? y : x;
  const n = Math.min(40, corto.length);
  for (let i = 0; i + n <= corto.length; i += 8) if (largo.includes(corto.slice(i, i + n))) return true;
  return false;
}
