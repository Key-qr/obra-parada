// Secciones de información: tipos de obra, récords, línea de tiempo,
// nivel de gobierno y modalidad, y comparador de departamentos.
// Las funciones reciben los datos y unos helpers de app.js (formato, acciones).

// ---------- tipo de obra a partir del nombre ----------
// El orden importa: "puente vehicular" es puente antes que pista; "canal de
// riego" es riego antes que agua. Ver la pregunta frecuente en la página.
export const TIPOS = [
  { id: "Puentes", re: /puente|pontón|ponton/, icon: '<path d="M2 16h20M4 16v-3a8 8 0 0 1 16 0v3M8 16v-5M12 16V9M16 16v-5"/>' },
  { id: "Riego", re: /riego|canal|reservorio|irrigac|bocatoma|represa/, icon: '<path d="M12 21c-3.5 0-6-2.4-6-5.6C6 11.6 12 4 12 4s6 7.6 6 11.4c0 3.2-2.5 5.6-6 5.6Z"/><path d="M3 21h18"/>' },
  { id: "Colegios", re: /educativ|colegio|escuela|institucion educativa|i\.e\.|aula|inicial|primaria|secundaria|instituto/, icon: '<path d="M3 10 12 5l9 5-9 5-9-5Z"/><path d="M7 12v5c3 2 7 2 10 0v-5"/>' },
  { id: "Salud", re: /salud|hospital|posta|clinica|clínica|policlinico/, icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>' },
  { id: "Agua y desagüe", re: /agua|saneamiento|alcantarillado|desag|potable|ptar/, icon: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>' },
  { id: "Deporte y recreación", re: /deport|losa|estadio|coliseo|polideportivo|parque|plaza/, icon: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16"/>' },
  { id: "Pistas y caminos", re: /transitabilidad|vial|pista|carretera|camino|vehicular|vereda|pavimenta|trocha|avenida|jiron|jirón/, icon: '<path d="M8 3 4 21M16 3l4 18M12 5v3M12 11v3M12 17v3"/>' },
  { id: "Otras", re: /.*/, icon: '<rect x="4" y="9" width="16" height="11"/><path d="M8 9V5h8v4"/>' },
];

const strip = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function tipoDe(nombre) {
  const n = strip(nombre);
  return TIPOS.find((t) => t.re.test(n)).id;
}
const iconSvg = (t) => `<svg viewBox="0 0 24 24" aria-hidden="true">${TIPOS.find((x) => x.id === t).icon}</svg>`;

// ---------- tipos ----------
export function renderTipos(scope, h) {
  const grid = document.getElementById("tipo-grid");
  const tot = scope.reduce((s, o) => s + (o.saldo || 0), 0) || 1;
  const by = new Map(TIPOS.map((t) => [t.id, { n: 0, saldo: 0, av: [] }]));
  for (const o of scope) { const a = by.get(o.tipo); a.n++; a.saldo += o.saldo || 0; a.av.push(o.avance); }
  const items = TIPOS.map((t) => ({ t, ...by.get(t.id) })).filter((x) => x.n || x.t.id === h.state.tipo);
  grid.innerHTML = items.map(({ t, n, saldo, av }) => `
    <li><button type="button" class="tipo${h.state.tipo === t.id ? " is-on" : ""}" data-tipo="${t.id}" aria-pressed="${h.state.tipo === t.id}">
      ${iconSvg(t.id)}
      <span class="tipo-name">${t.id}</span>
      <span class="tipo-n" data-n="${n}">${h.nf.format(n)}</span>
      <span class="tipo-sub">${n === 1 ? "obra" : "obras"}, ${h.solesCorto(saldo)} pendientes</span>
      <span class="tipo-bar" aria-hidden="true"><i style="width:${(saldo / tot) * 100}%"></i></span>
      <span class="tipo-sub">Avance mediano ${av.length ? h.nf1.format(h.median(av)) + "%" : "–"}</span>
    </button></li>`).join("");
  grid.querySelectorAll(".tipo-n").forEach((el) => h.countTo(el, Number(el.dataset.n), (v) => h.nf.format(Math.round(v))));
}

export function bindTipos(h) {
  const grid = document.getElementById("tipo-grid");
  const peek = document.getElementById("peek");
  const fine = matchMedia("(pointer: fine)").matches;
  let cur = null;
  grid.addEventListener("pointerover", (e) => {
    const b = e.target.closest("[data-tipo]");
    if (!b || !fine || b.dataset.tipo === cur) return;
    cur = b.dataset.tipo;
    const rows = h.scope().filter((o) => o.tipo === cur).sort((a, c) => (c.saldo || 0) - (a.saldo || 0)).slice(0, 3);
    peek.classList.add("peek-wide");
    peek.innerHTML = `<span class="bolt tl"></span><span class="bolt tr"></span>
      <span class="p-k">Ejemplos con más dinero pendiente</span>
      <span class="p-name">${cur}</span>
      ${rows.map((o) => `<span class="p-ex"><span>${h.esc(o.nombre.length > 80 ? o.nombre.slice(0, 78) + "…" : o.nombre)}</span><small>${h.esc(o.dist || o.prov || o.dep || "")}, ${h.solesCorto(o.saldo)}, ${o.avance != null ? h.nf1.format(o.avance) + "%" : "–"}</small></span>`).join("") || '<span class="p-k">Sin obras con estos filtros</span>'}
      <span class="p-k">Clic para filtrar el mapa por este tipo</span>`;
    peek.hidden = false;
    peek.classList.remove("is-in"); void peek.offsetWidth; peek.classList.add("is-in");
    const r = b.getBoundingClientRect(), w = peek.offsetWidth, ph = peek.offsetHeight;
    const x = r.right + 12 + w < innerWidth ? r.right + 12 : Math.max(8, r.left - w - 12);
    peek.style.transform = `translate(${x}px, ${Math.min(Math.max(8, r.top), innerHeight - ph - 8)}px)`;
  });
  grid.addEventListener("pointerleave", () => { cur = null; peek.hidden = true; peek.classList.remove("peek-wide"); });
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tipo]");
    if (!b) return;
    peek.hidden = true; cur = null;
    const sel = document.getElementById("f-tipo");
    const next = h.state.tipo === b.dataset.tipo ? "" : b.dataset.tipo;
    sel.value = next;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    h.toast(next ? `Filtrando el mapa: ${next}` : "Filtro de tipo quitado");
  });
}

// ---------- récords ----------
export function renderRecords(obras, h) {
  const max = (arr, f) => arr.reduce((a, o) => (f(o) > f(a) ? o : a), arr[0]);
  const conDato = (k) => obras.filter((o) => o[k] != null);
  const saldo = max(obras, (o) => o.saldo || 0);
  const viejo = max(conDato("anios"), (o) => o.anios);
  const casi = max(obras.filter((o) => o.avance != null && o.avance < 100 && (o.saldo || 0) > 0), (o) => o.avance);
  const cuenta = (k) => { const m = new Map(); for (const o of obras) if (o[k]) m.set(o[k], (m.get(o[k]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]; };
  const [ent, entN] = cuenta("entidad") || [];
  const [dist, distN] = cuenta("u_dist") || [];
  const depS = new Map(); for (const o of obras) if (o.u_dep) depS.set(o.u_dep, (depS.get(o.u_dep) || 0) + (o.saldo || 0));
  const [dep, depV] = [...depS.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const distObra = obras.find((o) => o.u_dist === dist);
  const depObra = obras.find((o) => o.u_dep === dep);
  const lugar = (o) => [o.dist, o.prov, o.dep].filter(Boolean).join(", ");

  const cards = [
    { k: "La obra con más dinero pendiente", v: h.soles(saldo.saldo), name: saldo.nombre, sub: lugar(saldo), act: `obra:${saldo._i}` },
    { k: "La que lleva más tiempo parada", v: h.anios(viejo?.anios), name: viejo?.nombre, sub: `${lugar(viejo)}. Desde ${h.fecha(viejo?.f_paral)}`, act: `obra:${viejo?._i}` },
    { k: "Se paró casi terminada", v: `${h.nf1.format(casi?.avance)}%`, name: casi?.nombre, sub: `${lugar(casi)}. Le falta ${h.soles(casi?.saldo)}`, act: `obra:${casi?._i}` },
    { k: "La entidad con más obras paralizadas", v: `${h.nf.format(entN)} obras`, name: h.titulo(ent), sub: "Ver en la tabla de entidades", act: "ent" },
    { k: "El distrito con más obras paralizadas", v: `${h.nf.format(distN)} obras`, name: distObra?.dist, sub: [distObra?.prov, distObra?.dep].filter(Boolean).join(", "), act: `zona:distrito:${dist}` },
    { k: "El departamento con más dinero parado", v: h.soles(depV), name: depObra?.dep, sub: `${h.nf.format(obras.filter((o) => o.u_dep === dep).length)} obras`, act: `zona:departamento:${dep}` },
  ];
  const grid = document.getElementById("rec-grid");
  grid.innerHTML = cards.map((c, i) => `
    <li style="--d:${i * 70}ms"><button type="button" class="rec" data-act="${c.act}">
      <span class="rec-k">${c.k}</span>
      <span class="rec-v">${h.esc(c.v)}</span>
      <span class="rec-name">${h.esc(c.name || "Sin dato")}</span>
      <span class="rec-sub">${h.esc(c.sub || "")}</span>
    </button></li>`).join("");
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const [kind, a, c] = b.dataset.act.split(":");
    if (kind === "obra") h.openObra(Number(a));
    else if (kind === "ent") { document.querySelector('[data-sort="obras"]').click(); document.getElementById("entidades").scrollIntoView({ behavior: h.reduced ? "auto" : "smooth" }); }
    else if (kind === "zona") { document.getElementById("mapa").scrollIntoView({ behavior: h.reduced ? "auto" : "smooth" }); h.select(a, c); }
  });
}

// ---------- línea de tiempo ----------
export function renderTimeline(scope, h) {
  const el = document.getElementById("timeline");
  const metric = h.state.tlMetric;
  const corteY = Number((h.meta.corte || "").slice(0, 4)) || new Date().getFullYear();
  const years = new Map();
  let sinFecha = 0;
  for (const o of scope) {
    if (!o.f_paral) { sinFecha++; continue; }
    const y = Number(o.f_paral.slice(0, 4));
    const a = years.get(y) || { obras: 0, saldo: 0 };
    a.obras++; a.saldo += o.saldo || 0; years.set(y, a);
  }
  if (!years.size) { el.innerHTML = `<p class="empty-note">Sin fechas de paralización con estos filtros.</p>`; return; }
  const y0 = Math.min(...years.keys()), y1 = Math.max(corteY, ...years.keys());
  const list = []; for (let y = y0; y <= y1; y++) list.push([y, years.get(y) || { obras: 0, saldo: 0 }]);
  const max = Math.max(1, ...list.map(([, a]) => a[metric]));
  const peak = list.reduce((a, b) => (b[1][metric] > a[1][metric] ? b : a));
  el.innerHTML = `<div class="tl-cols">${list.map(([y, a], i) => `
    <div class="tl-col${y === peak[0] ? " is-peak" : ""}" tabindex="0" data-y="${y}" aria-label="${y}: ${h.nf.format(a.obras)} obras, ${h.soles(a.saldo)}">
      <span class="tl-val">${metric === "saldo" ? h.solesCorto(a.saldo) : h.nf.format(a.obras)}</span>
      <span class="tl-bar"><i style="height:${(a[metric] / max) * 100}%; transition-delay:${i * 30}ms"></i></span>
      <span class="tl-y">${list.length > 12 ? "’" + String(y).slice(2) : y}</span>
    </div>`).join("")}</div>`;
  document.getElementById("tl-note").textContent =
    `Según el año en que dejaron de avanzar. El año con más ${metric === "saldo" ? "dinero parado" : "obras paralizadas"} fue ${peak[0]}.${sinFecha ? ` ${h.nf.format(sinFecha)} sin fecha.` : ""}`;
}

// ---------- nivel de gobierno y modalidad ----------
const NOMBRE_NIVEL = { Local: "Municipalidades", Regional: "Gobiernos regionales", Nacional: "Gobierno nacional" };
export function renderGob(scope, h) {
  const tot = { n: scope.length || 1, s: scope.reduce((s, o) => s + (o.saldo || 0), 0) || 1 };
  const m = new Map();
  for (const o of scope) { const a = m.get(o.nivel) || { n: 0, s: 0 }; a.n++; a.s += o.saldo || 0; m.set(o.nivel, a); }
  const rows = ["Local", "Regional", "Nacional"].filter((k) => m.has(k)).map((k) => [k, m.get(k)]);
  document.getElementById("gob").innerHTML = rows.map(([k, a]) => `
    <div class="gob-row">
      <span class="gob-name">${NOMBRE_NIVEL[k] || k}</span>
      <span class="gob-bars">
        <span class="gob-line"><small>Obras</small><span class="gob-track"><i style="width:${(a.n / tot.n) * 100}%"></i></span><b>${h.nf1.format((a.n / tot.n) * 100)}%</b></span>
        <span class="gob-line is-money"><small>Dinero</small><span class="gob-track"><i style="width:${(a.s / tot.s) * 100}%"></i></span><b>${h.nf1.format((a.s / tot.s) * 100)}%</b></span>
      </span>
    </div>`).join("") || `<p class="empty-note">Sin obras con estos filtros.</p>`;
  // Tamaño promedio de lo pendiente por obra, para comparar niveles con números y no con adjetivos.
  const prom = rows.map(([k, a]) => [k, a.s / a.n]).sort((x, y) => y[1] - x[1]);
  const loc = m.get("Local");
  const mayor = prom[0], menor = prom[prom.length - 1];
  document.getElementById("gob-note").textContent = loc && prom.length > 1
    ? `Las municipalidades tienen el ${h.nf1.format((loc.n / tot.n) * 100)}% de las obras paralizadas y el ${h.nf1.format((loc.s / tot.s) * 100)}% del dinero pendiente. En promedio, a cada obra ${mayor[0] === "Local" ? "municipal" : mayor[0] === "Regional" ? "regional" : "del gobierno nacional"} le faltan ${h.solesCorto(mayor[1])}, frente a ${h.solesCorto(menor[1])} en ${menor[0] === "Local" ? "las municipales" : menor[0] === "Regional" ? "las regionales" : "las del gobierno nacional"}.`
    : "Porcentaje de obras y de dinero pendiente según quién ejecuta.";

  const mm = new Map();
  for (const o of scope) { const a = mm.get(o.modalidad) || []; a.push(o); mm.set(o.modalidad, a); }
  document.getElementById("mod-body").innerHTML = [...mm.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, arr]) => `
    <tr><td>${h.esc(k)}</td><td class="num">${h.nf.format(arr.length)}</td>
    <td class="num">${h.nf1.format(h.median(arr.map((o) => o.avance)) ?? 0)}%</td>
    <td class="num">${h.anios(h.median(arr.map((o) => o.anios)))}</td>
    <td class="num">${h.soles(arr.reduce((s, o) => s + (o.saldo || 0), 0))}</td></tr>`).join("");
}

// ---------- comparador ----------
export function initCompare(obras, h) {
  const deps = new Map();
  for (const o of obras) if (o.u_dep) { if (!deps.has(o.u_dep)) deps.set(o.u_dep, { nombre: o.dep, rows: [] }); deps.get(o.u_dep).rows.push(o); }
  const ids = [...deps.keys()].sort((a, b) => deps.get(a).nombre.localeCompare(deps.get(b).nombre, "es"));
  const bySaldo = [...deps.keys()].sort((a, b) => sum(deps.get(b).rows) - sum(deps.get(a).rows));
  const selA = document.getElementById("cmp-a"), selB = document.getElementById("cmp-b");
  const opts = ids.map((id) => `<option value="${id}">${h.esc(deps.get(id).nombre)}</option>`).join("");
  selA.innerHTML = opts; selB.innerHTML = opts;
  selA.value = bySaldo[0]; selB.value = bySaldo[1] || bySaldo[0];

  const stats = (rows) => {
    const top = (k) => { const m = new Map(); for (const o of rows) m.set(o[k], (m.get(o[k]) || 0) + (o.saldo || 0)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "–"; };
    return {
      obras: rows.length, saldo: sum(rows), costo: rows.reduce((s, o) => s + (o.costo || 0), 0),
      avance: h.median(rows.map((o) => o.avance)) ?? 0, anios: h.median(rows.map((o) => o.anios)) ?? 0,
      casi: rows.filter((o) => (o.avance ?? 0) >= 90).length, causa: top("causal"), tipo: top("tipo"),
    };
  };
  const METRICS = [
    ["obras", "Obras paralizadas", (v) => h.nf.format(v)],
    ["saldo", "Falta ejecutar", h.solesCorto],
    ["costo", "Costo actualizado", h.solesCorto],
    ["avance", "Avance mediano", (v) => `${h.nf1.format(v)}%`],
    ["anios", "Tiempo parada (mediana)", h.anios],
    ["casi", "Construidas al 90% o más", (v) => h.nf.format(v)],
  ];
  const board = document.getElementById("cmp-board");
  function draw() {
    const A = deps.get(selA.value), B = deps.get(selB.value);
    const a = stats(A.rows), b = stats(B.rows);
    board.innerHTML = `
      <div class="cmp-head"><strong>${h.esc(A.nombre)}</strong>${h.dotCountry(selA.value, "a", A.rows)}<span class="cmp-cap">${h.nf.format(A.rows.length)} obras paralizadas</span></div>
      <div class="cmp-spacer"><span class="cmp-vs">frente a</span></div>
      <div class="cmp-head is-b"><strong>${h.esc(B.nombre)}</strong>${h.dotCountry(selB.value, "b", B.rows)}<span class="cmp-cap">${h.nf.format(B.rows.length)} obras paralizadas</span></div>
      ${METRICS.map(([k, label, f]) => {
        const mx = Math.max(a[k], b[k]) || 1;
        return `<div class="cmp-label">${label}</div>
          <div class="cmp-side"><b>${f(a[k])}</b><span class="cmp-track"><i style="width:${(a[k] / mx) * 100}%"></i></span></div>
          <div class="cmp-side is-b"><span class="cmp-track"><i style="width:${(b[k] / mx) * 100}%"></i></span><b>${f(b[k])}</b></div>`;
      }).join("")}
      <div class="cmp-label">Causa con más dinero</div><div class="cmp-text">${h.esc(a.causa)}</div><div class="cmp-text is-b">${h.esc(b.causa)}</div>
      <div class="cmp-label">Tipo de obra con más dinero</div><div class="cmp-text">${h.esc(a.tipo)}</div><div class="cmp-text is-b">${h.esc(b.tipo)}</div>`;
    // Las barras crecen desde cero en cada cambio.
    board.classList.remove("is-in"); void board.offsetWidth; board.classList.add("is-in");
  }
  selA.addEventListener("change", draw); selB.addEventListener("change", draw);
  // Cursor sobre una obra del mapa de puntos: sale su detalle; clic abre la ficha.
  board.addEventListener("pointermove", (e) => {
    const c = e.target.closest(".o-dot");
    if (c) h.obraTip(obras[Number(c.dataset.i)], e.clientX, e.clientY); else h.hideTip();
  });
  board.addEventListener("pointerleave", () => h.hideTip());
  board.addEventListener("click", (e) => { const c = e.target.closest(".o-dot"); if (c) { h.hideTip(); h.openObra(Number(c.dataset.i)); } });
  document.getElementById("cmp-swap").addEventListener("click", () => { const t = selA.value; selA.value = selB.value; selB.value = t; draw(); });
  draw();
}
const sum = (rows) => rows.reduce((s, o) => s + (o.saldo || 0), 0);
