// Botón de ayuda fijo abajo a la derecha, en todas las páginas.
// Abre una ventana con dos pestañas: preguntas frecuentes y entidades con obras paralizadas.
// Va sin módulos ni dependencias para que lo carguen igual la portada y las páginas del canvas.
(() => {
  if (document.getElementById("ayuda-btn")) return;

  const PREGUNTAS = [
    ["¿Qué es una obra paralizada?",
      "Para la Contraloría, es una obra pública que no registra avance físico por seis meses o más en Infobras, el sistema donde las entidades deben reportar el avance de sus obras. No importa si la obra está abandonada, en arbitraje o esperando presupuesto: si no avanza, cuenta."],
    ["¿Qué diferencia hay entre costo actualizado y lo que falta ejecutar?",
      "El costo actualizado es lo que cuesta la obra completa hoy, con sus adicionales y ampliaciones. Lo que falta ejecutar es la parte de ese costo que todavía no se ha gastado: lo mínimo que haría falta para terminarla, sin contar lo que pueda deteriorarse mientras está parada."],
    ["¿Qué es la administración directa?",
      "Es cuando la propia entidad (una municipalidad, por ejemplo) construye la obra con su personal y maquinaria, en vez de contratar a una empresa. La otra modalidad común es por contrata, cuando una empresa la gana en un proceso de selección."],
    ["¿Qué son el CUI y el código Infobras?",
      "El CUI (Código Único de Inversiones) identifica el proyecto en Invierte.pe, el sistema del MEF; con él puedes ver su presupuesto y su ejecución en el Seguimiento de Inversiones. El código Infobras identifica la obra en el sistema de la Contraloría, donde están sus fotos y avances reportados."],
    ["¿Cómo se clasifica el tipo de obra?",
      "Con la clasificación que trae la propia base de la Contraloría (tipo de obra en tres niveles; aquí se usa el segundo). Solo si una obra viene sin tipo se adivina por palabras del nombre: \"educativo\" o \"colegio\" es educación, \"agua potable\" es saneamiento, y así."],
    ["¿Por qué no dice desde cuándo está paralizada cada obra?",
      "Porque la base de junio de 2026 no trae la fecha de paralización. Lo que sí trae es el año en que empezó la obra, y eso es lo que se usa para medir el tiempo: una obra que empezó en 2012 y sigue sin terminarse lleva más de una década pendiente, aunque no se sepa el mes exacto en que se detuvo."],
    ["¿Qué es el PIM y por qué importa?",
      "El Presupuesto Institucional Modificado es la plata que una entidad tiene asignada para un proyecto en el año. Una obra paralizada sin PIM no tiene con qué reactivarse ese año, por mucho que se quiera. La lista priorizada es otra cosa: es la relación de obras que el Estado eligió para reactivar primero, aprobada por resolución."],
    ["¿Qué es un servicio de control?",
      "Es cualquier revisión que hace la Contraloría o el órgano de control de la entidad (OCI): control concurrente mientras la obra avanza, visitas, orientaciones de oficio, auditorías. Cada uno termina en un informe, y la mayoría está publicado. En <a href=\"control.html\">Servicios de control</a> los puedes buscar por obra, lugar, tipo o año."],
    ["¿Cada cuánto se actualiza?",
      "La Contraloría publica un informe cada trimestre. Un proceso automático revisa gob.pe cada lunes; cuando aparece un archivo nuevo, lo procesa, valida y publica sin intervención manual."],
    ["¿Que una obra esté paralizada significa que hubo corrupción?",
      "No. Las causas más comunes son falta de presupuesto, problemas con el contratista o deficiencias en el expediente técnico. Esta página muestra los datos oficiales; no acusa a ninguna persona ni entidad."],
  ];

  const ORDENES = [["saldo", "Falta ejecutar"], ["obras", "Obras"], ["casi", "Con 90%+ de avance"]];

  const css = `
.ay-btn { position: fixed; right: 20px; bottom: 20px; z-index: 70; width: 56px; height: 56px; border-radius: 50%; border: 2px solid #1f2326; background: #e9a21a; color: #1f2326; cursor: pointer; display: grid; place-items: center; box-shadow: 0 6px 18px rgba(31,35,38,.28); transition: transform .2s, background-color .2s; font: 800 30px/1 "Barlow Condensed", "Arial Narrow", sans-serif; padding: 0; }
.ay-btn:hover { transform: translateY(-2px) rotate(-6deg); }
.ay-btn:focus-visible { outline: 3px solid #17457a; outline-offset: 3px; }
.ay-btn .ay-x { display: none; font-size: 34px; font-weight: 600; }
.ay-btn[aria-expanded="true"] { background: #1f2326; color: #fff; }
.ay-btn[aria-expanded="true"] .ay-q { display: none; }
.ay-btn[aria-expanded="true"] .ay-x { display: block; }
.ay-btn::after { content: ""; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid #e9a21a; animation: ay-ping 2.4s ease-out 1.2s 2; pointer-events: none; opacity: 0; }
@keyframes ay-ping { 0% { opacity: .9; transform: scale(1); } 100% { opacity: 0; transform: scale(1.6); } }

.ay-panel { position: fixed; right: 20px; bottom: 88px; z-index: 70; width: min(440px, calc(100vw - 40px)); height: min(620px, calc(100vh - 120px)); height: min(620px, calc(100dvh - 120px)); display: flex; flex-direction: column; background: #f4f5f3; border: 2px solid #1f2326; box-shadow: 0 18px 50px rgba(31,35,38,.3); transform-origin: calc(100% - 28px) calc(100% + 40px); transition: opacity .2s, transform .25s cubic-bezier(.2,.8,.3,1.2), visibility 0s .25s; opacity: 0; transform: scale(.6); visibility: hidden; font: 400 16px/1.5 "Barlow", system-ui, sans-serif; color: #1f2326; }
.ay-panel.abierto { opacity: 1; transform: none; visibility: visible; transition: opacity .2s, transform .25s cubic-bezier(.2,.8,.3,1.2), visibility 0s; }
.ay-head { display: flex; align-items: stretch; background: #1f2326; color: #fff; }
.ay-tabs { display: flex; flex: 1; }
.ay-tabs button { flex: 1; border: 0; background: none; color: #c9cdc8; font: 600 18px/1 "Barlow Condensed", "Arial Narrow", sans-serif; padding: 14px 10px 12px; cursor: pointer; border-bottom: 4px solid transparent; }
.ay-tabs button[aria-selected="true"] { color: #fff; border-bottom-color: #e9a21a; }
.ay-tabs button:focus-visible, .ay-cerrar:focus-visible { outline: 3px solid #e9a21a; outline-offset: -3px; }
.ay-cerrar { border: 0; background: none; color: #fff; font: 400 28px/1 system-ui, sans-serif; width: 48px; cursor: pointer; }
.ay-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 4px 18px 18px; }
.ay-body[hidden] { display: none; }
.ay-body a { color: #17457a; }

.ay-faq details { border-bottom: 1px solid #b9bdbb; }
.ay-faq summary { list-style: none; cursor: pointer; position: relative; padding: 14px 32px 14px 0; font: 600 18px/1.25 "Barlow Condensed", "Arial Narrow", sans-serif; }
.ay-faq summary::-webkit-details-marker { display: none; }
.ay-faq summary::before, .ay-faq summary::after { content: ""; position: absolute; right: 6px; top: 50%; width: 14px; height: 2px; background: #1f2326; transition: transform .3s; }
.ay-faq summary::before { transform: rotate(90deg); }
.ay-faq details[open] summary::before { transform: rotate(0); }
.ay-faq summary:hover { color: #17457a; }
.ay-faq summary:focus-visible { outline: 3px solid #e9a21a; outline-offset: 2px; }
.ay-faq details p { margin: 0 0 14px; color: #343a3e; font-size: 15px; animation: ay-abrir .3s ease-out; }
@keyframes ay-abrir { from { opacity: 0; transform: translateY(-4px); } }

.ay-nota { margin: 12px 0; font-size: 14px; color: #5d6468; }
.ay-buscar { width: 100%; box-sizing: border-box; border: 2px solid #1f2326; background: #fff; padding: 9px 12px; font: 400 16px "Barlow", system-ui, sans-serif; }
.ay-buscar:focus { outline: 3px solid #e9a21a; outline-offset: 0; }
.ay-orden { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.ay-orden span { font: 600 14px/28px "Barlow Condensed", sans-serif; color: #5d6468; margin-right: 2px; }
.ay-orden button { border: 1.5px solid #1f2326; background: #fff; padding: 4px 10px; font: 600 14px "Barlow Condensed", sans-serif; cursor: pointer; }
.ay-orden button[aria-pressed="true"] { background: #1f2326; color: #fff; }
.ay-lista { list-style: none; margin: 8px 0 0; padding: 0; counter-reset: ay; }
.ay-lista li { display: grid; grid-template-columns: 26px 1fr auto; gap: 2px 8px; padding: 10px 0; border-bottom: 1px solid #b9bdbb; counter-increment: ay; animation: ay-fila .3s ease-out backwards; }
.ay-lista li::before { content: counter(ay); font: 700 15px/1.3 "Barlow Condensed", sans-serif; color: #8a5a00; }
.ay-lista b { font-weight: 600; font-size: 15px; line-height: 1.3; }
.ay-lista small { grid-column: 2; font-size: 13px; color: #5d6468; }
.ay-lista .ay-num { grid-column: 3; grid-row: 1 / span 2; text-align: right; font: 700 17px/1.2 "Barlow Condensed", sans-serif; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ay-lista .ay-num small { display: block; font: 400 12px "Barlow", sans-serif; }
.ay-vacio { padding: 16px 0; color: #5d6468; }
@keyframes ay-fila { from { opacity: 0; transform: translateY(6px); } }

@media (max-width: 640px) {
  .ay-btn { right: 14px; bottom: 14px; width: 52px; height: 52px; }
  .ay-panel { right: 10px; left: 10px; bottom: 76px; width: auto; height: min(560px, calc(100dvh - 100px)); }
}
@media (prefers-reduced-motion: reduce) {
  .ay-btn, .ay-panel, .ay-panel.abierto { transition: none; }
  .ay-btn::after, .ay-lista li, .ay-faq details p { animation: none; }
}`;

  const nf = new Intl.NumberFormat("es-PE");
  const nf1 = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });
  const solesCorto = (v) => v >= 1e9 ? `S/ ${nf1.format(v / 1e9)} mil M` : v >= 1e6 ? `S/ ${nf1.format(v / 1e6)} M` : v >= 1e3 ? `S/ ${nf.format(Math.round(v / 1e3))} mil` : `S/ ${nf.format(Math.round(v))}`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const MENORES = new Set(["de", "del", "la", "las", "los", "y", "el"]);
  const titulo = (s) => String(s ?? "").toLowerCase().split(/\s+/).map((w, i) => (i && MENORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "ayuda-btn";
  btn.className = "ay-btn";
  btn.setAttribute("aria-label", "Ayuda: preguntas frecuentes y entidades");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "ayuda");
  btn.innerHTML = `<span class="ay-q" aria-hidden="true">?</span><span class="ay-x" aria-hidden="true">×</span>`;

  const panel = document.createElement("section");
  panel.id = "ayuda";
  panel.className = "ay-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Ayuda");
  panel.innerHTML = `
    <div class="ay-head">
      <div class="ay-tabs" role="tablist">
        <button type="button" role="tab" id="ay-t-faq" aria-controls="ay-faq" aria-selected="true">Preguntas frecuentes</button>
        <button type="button" role="tab" id="ay-t-ent" aria-controls="ay-ent" aria-selected="false" tabindex="-1">Entidades</button>
      </div>
      <button type="button" class="ay-cerrar" aria-label="Cerrar">×</button>
    </div>
    <div class="ay-body ay-faq" id="ay-faq" role="tabpanel" aria-labelledby="ay-t-faq">
      ${PREGUNTAS.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}
    </div>
    <div class="ay-body ay-ent" id="ay-ent" role="tabpanel" aria-labelledby="ay-t-ent" hidden>
      <p class="ay-nota">Entidades con obras paralizadas en todo el país. Tener obras paralizadas no prueba una mala gestión actual: muchas vienen de gestiones anteriores.</p>
      <input class="ay-buscar" type="search" placeholder="Busca una entidad o departamento" aria-label="Buscar entidad">
      <div class="ay-orden" role="group" aria-label="Ordenar por"><span>Ordenar por</span>
        ${ORDENES.map(([k, t], i) => `<button type="button" data-k="${k}" aria-pressed="${i === 0}">${t}</button>`).join("")}
      </div>
      <ol class="ay-lista" aria-live="polite"><li class="ay-vacio" style="display:block">Cargando entidades…</li></ol>
    </div>`;

  document.body.append(panel, btn);

  const tabs = [...panel.querySelectorAll('[role="tab"]')];
  const lista = panel.querySelector(".ay-lista");
  const buscar = panel.querySelector(".ay-buscar");
  let ENT = null, cargando = null, orden = "saldo";

  function cargar() {
    if (ENT || cargando) return cargando;
    cargando = fetch("data/obras.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((d) => {
      const c = Object.fromEntries(d.cols.map((k, i) => [k, i]));
      const m = new Map();
      for (const r of d.rows) {
        const e = r[c.entidad];
        if (!e) continue;
        const a = m.get(e) || { n: titulo(e), q: norm(e), nivel: r[c.nivel], dep: r[c.dep], obras: 0, saldo: 0, casi: 0 };
        a.obras++; a.saldo += r[c.saldo] || 0; if ((r[c.avance] ?? 0) >= 90) a.casi++;
        m.set(e, a);
      }
      ENT = [...m.values()];
      pintar();
    }).catch(() => { lista.innerHTML = `<li class="ay-vacio" style="display:block">No se pudo cargar la lista de entidades.</li>`; cargando = null; });
    return cargando;
  }

  function pintar() {
    if (!ENT) return;
    const q = norm(buscar.value.trim());
    const filas = ENT.filter((e) => !q || e.q.includes(q) || norm(e.dep).includes(q))
      .sort((a, b) => b[orden] - a[orden] || b.saldo - a.saldo).slice(0, q ? 60 : 30);
    const valor = (e) => orden === "saldo" ? `${solesCorto(e.saldo)}<small>${nf.format(e.obras)} ${e.obras === 1 ? "obra" : "obras"}</small>`
      : orden === "obras" ? `${nf.format(e.obras)}<small>${solesCorto(e.saldo)}</small>`
      : `${nf.format(e.casi)}<small>de ${nf.format(e.obras)} obras</small>`;
    lista.innerHTML = filas.length
      ? filas.map((e, i) => `<li style="animation-delay:${Math.min(i, 12) * 25}ms"><b>${esc(e.n)}</b><span class="ay-num">${valor(e)}</span><small>${esc(e.dep || "")}${e.nivel ? ` · Gobierno ${esc(String(e.nivel).toLowerCase())}` : ""}</small></li>`).join("")
      : `<li class="ay-vacio" style="display:block">Ninguna entidad con “${esc(buscar.value.trim())}”.</li>`;
  }

  function pestana(cual) {
    tabs.forEach((t) => {
      const on = t.id === `ay-t-${cual}`;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (cual === "ent") cargar();
  }

  function abrir(cual, opts = {}) {
    if (cual) pestana(cual);
    if (opts.orden) { orden = opts.orden; panel.querySelectorAll(".ay-orden button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === orden)); pintar(); }
    panel.classList.add("abierto");
    btn.setAttribute("aria-expanded", "true");
    setTimeout(() => panel.querySelector('[role="tab"][aria-selected="true"]').focus({ preventScroll: true }), 60);
  }
  function cerrar(volver = true) {
    if (!panel.classList.contains("abierto")) return;
    panel.classList.remove("abierto");
    btn.setAttribute("aria-expanded", "false");
    if (volver) btn.focus({ preventScroll: true });
  }

  btn.addEventListener("click", () => (panel.classList.contains("abierto") ? cerrar() : abrir()));
  panel.querySelector(".ay-cerrar").addEventListener("click", () => cerrar());
  tabs.forEach((t) => t.addEventListener("click", () => pestana(t.id.slice(5))));
  panel.querySelector(".ay-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const sig = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    pestana(sig.id.slice(5)); sig.focus();
  });
  panel.querySelector(".ay-orden").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    orden = b.dataset.k;
    panel.querySelectorAll(".ay-orden button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    pintar();
  });
  let t = 0;
  buscar.addEventListener("input", () => { clearTimeout(t); t = setTimeout(pintar, 120); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });
  document.addEventListener("pointerdown", (e) => {
    if (!panel.contains(e.target) && !btn.contains(e.target)) cerrar(false);
  });

  // Enlaces viejos (#faq, #entidades) y cualquier enlace interno que apunte ahí abren la ventana.
  const desdeHash = () => {
    const h = location.hash.slice(1);
    if (h === "faq" || h === "entidades") abrir(h === "faq" ? "faq" : "ent");
  };
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href$="#faq"], a[href$="#entidades"]');
    if (!a || panel.contains(a)) return;
    e.preventDefault();
    abrir(a.getAttribute("href").endsWith("#faq") ? "faq" : "ent");
  });
  desdeHash();
  addEventListener("hashchange", desdeHash);

  window.ayuda = { abrir, cerrar };
})();
