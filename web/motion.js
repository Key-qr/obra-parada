// Movimiento de la página: textos que se "decodifican", contadores, inclinación
// del cartel, barra de avance de lectura y la terminal que se escribe al hacer
// scroll. Todo respeta prefers-reduced-motion: sin animación, el estado final
// aparece de inmediato.

export const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

const GLYPHS_NUM = "0123456789";
const GLYPHS_TXT = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ0123456789#%/_<>";

// ---------- texto que se decodifica ----------
const running = new WeakMap();

export function scramble(el, text = el.textContent, duration = 900) {
  if (reduced || !text) { el.textContent = text; return Promise.resolve(); }
  cancelAnimationFrame(running.get(el));
  const chars = [...text];
  const start = performance.now();
  // Cada carácter se fija en un momento distinto, de izquierda a derecha con algo de azar.
  const lockAt = chars.map((_, i) => (i / chars.length) * duration * 0.7 + Math.random() * duration * 0.3);
  return new Promise((resolve) => {
    const frame = (now) => {
      const t = now - start;
      let out = "";
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (t >= lockAt[i] || c === " " || c === "," || c === ".") out += c;
        else {
          const pool = /\d/.test(c) ? GLYPHS_NUM : GLYPHS_TXT;
          out += pool[(Math.random() * pool.length) | 0];
        }
      }
      el.textContent = out;
      if (t < duration) running.set(el, requestAnimationFrame(frame));
      else { el.textContent = text; resolve(); }
    };
    running.set(el, requestAnimationFrame(frame));
  });
}

// Decodifica cada elemento la primera vez que entra en pantalla.
export function decodeOnView(selector, duration = 700) {
  const els = document.querySelectorAll(selector);
  if (reduced) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      scramble(e.target, e.target.dataset.text || e.target.textContent, duration);
    }
  }, { threshold: 0.6 });
  els.forEach((el) => { el.dataset.text = el.textContent; el.setAttribute("aria-label", el.textContent); io.observe(el); });
}

// ---------- contadores ----------
const counters = new WeakMap();
export function countTo(el, to, fmt, duration = 650) {
  const from = counters.get(el) ?? 0;
  counters.set(el, to);
  if (reduced || from === to || to == null) { el.textContent = fmt(to); return; }
  const start = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const frame = (now) => {
    const p = Math.min(1, (now - start) / duration);
    el.textContent = fmt(from + (to - from) * ease(p));
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------- cartel que sigue al cursor ----------
export function tilt(area, el, max = 5) {
  if (reduced || !finePointer) return;
  let raf = 0;
  area.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
    const y = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      el.style.setProperty("--rx", `${(-y * max).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
      el.style.setProperty("--gx", `${50 + x * 40}%`);
      el.style.setProperty("--gy", `${50 + y * 40}%`);
    });
  });
  area.addEventListener("pointerleave", () => {
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  });
}

// ---------- barra de avance de lectura ----------
export function readingProgress(bar, label) {
  const update = () => {
    const h = document.documentElement;
    const p = Math.max(0, Math.min(1, h.scrollTop / (h.scrollHeight - h.clientHeight || 1)));
    bar.style.transform = `scaleX(${p})`;
    if (label) label.textContent = `${Math.round(p * 100)}%`;
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
}

// ---------- elementos que aparecen al entrar en pantalla ----------
export function revealOnView(selector, cls = "is-in") {
  const els = document.querySelectorAll(selector);
  if (reduced) { els.forEach((el) => el.classList.add(cls)); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); }
  }, { threshold: 0.25 });
  els.forEach((el) => io.observe(el));
}

// ---------- terminal ----------
// lines: [{ t: "texto", c: "clase opcional" }]. Escribe línea por línea; los
// comandos ($ ...) se teclean carácter por carácter, la salida aparece de golpe.
export function makeTerminal(body) {
  let token = 0;
  async function play(lines) {
    const my = ++token;
    body.innerHTML = "";
    for (const line of lines) {
      if (my !== token) return;
      const div = document.createElement("div");
      div.className = `tl ${line.c || ""}`;
      body.appendChild(div);
      if (reduced) { div.textContent = line.t; continue; }
      if (line.t.startsWith("$ ")) {
        for (let i = 1; i <= line.t.length; i++) {
          if (my !== token) return;
          div.textContent = line.t.slice(0, i);
          await sleep(line.t.length > 40 ? 9 : 22);
        }
        await sleep(160);
      } else {
        div.textContent = line.t;
        await sleep(55);
      }
      body.scrollTop = body.scrollHeight;
    }
  }
  return { play };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Activa el paso que cruza el centro de la pantalla y avisa con onStep(i).
export function scrollSteps(steps, onStep, rootMargin = "-45% 0px -45% 0px") {
  let current = -1;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = steps.indexOf(e.target);
      if (i === current) continue;
      current = i;
      steps.forEach((s, j) => s.classList.toggle("is-active", j === i));
      onStep(i);
    }
  }, { rootMargin });
  steps.forEach((s) => io.observe(s));
}
