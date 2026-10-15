// Arma web/data/obras_por_depto.json: una fila corta por obra, agrupadas por departamento,
// para las vistas de puntos (Simulador y Comparar). Corre después de `make export`:
//   node scripts/build_puntos.mjs
//
// Fila: [x, y, avance (-1 sin dato), causa 0-5, año de inicio - 2000 (0 sin dato),
//        falta ejecutar en millones (0 sin saldo), nombre, distrito, nivel L/R/N]
// x, y están en el mismo plano de 420 px de ancho que usan los mapas de puntos.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const topo = require('topojson-client');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const capa = (nivel) => {
  const t = leer(`web/data/geo/${nivel}.json`);
  return topo.feature(t, t.objects[Object.keys(t.objects)[0]]);
};

// proyección equirectangular con corrección por latitud, ajustada al ancho de 420
const deps = capa('departamentos');
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
const recorrer = (c, f) => (typeof c[0] === 'number' ? f(c) : c.forEach((k) => recorrer(k, f)));
deps.features.forEach((f) => recorrer(f.geometry.coordinates, ([x, y]) => {
  x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
}));
const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180), ANCHO = 420, sc = ANCHO / ((x1 - x0) * k);
const P = ([x, y]) => [(x - x0) * k * sc, (y1 - y) * sc];

// centro aproximado de cada zona: promedio de los vértices de su anillo más grande
const centro = (g) => {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const anillo = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
  let cx = 0, cy = 0;
  anillo.forEach(([a, b]) => { cx += a; cy += b; });
  return P([cx / anillo.length, cy / anillo.length]);
};
const C = {};
for (const nivel of ['distritos', 'provincias', 'departamentos']) {
  capa(nivel).features.forEach((f) => { if (f.geometry) C[f.properties.ubigeo] = centro(f.geometry); });
}

const o = leer('web/data/obras.json');
const obras = o.rows.map((r) => Object.fromEntries(o.cols.map((c, i) => [c, r[i]])));
const CAUSAS = ['Incumplimiento de contrato', 'Falta de recursos financieros y liquidez', 'Discrepancias, controversias y arbitraje', 'Deficiencia en el expediente técnico', 'Abandono de obra'];
const NIVEL = { Local: 'L', Regional: 'R', Nacional: 'N' };

// ruido fijo para separar obras del mismo distrito: el archivo sale igual en cada corrida
let semilla = 5;
const azar = () => ((semilla = (semilla * 16807) % 2147483647) - 1) / 2147483646;
const corto = (n) => {
  n = String(n).replace(/\s+/g, ' ').trim();
  if (n === n.toUpperCase()) { n = n.toLowerCase(); n = n[0].toUpperCase() + n.slice(1); }
  return n.length > 70 ? `${n.slice(0, 68)}…` : n;
};
const titulo = (n) => String(n || '').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

const out = {};
let sinLugar = 0;
for (const x of obras.sort((a, b) => (b.saldo || 0) - (a.saldo || 0))) {
  const c = C[x.u_dist] || C[x.u_prov] || C[x.u_dep];
  if (!c) { sinLugar++; continue; }
  const j = C[x.u_dist] ? 3 : 10;
  const ci = CAUSAS.indexOf(x.causal);
  (out[x.u_dep] = out[x.u_dep] || []).push([
    Math.round(c[0] + (azar() - 0.5) * j), Math.round(c[1] + (azar() - 0.5) * j),
    x.avance == null ? -1 : Math.round(x.avance),
    ci < 0 ? 5 : ci,
    x.ini ? x.ini - 2000 : 0,
    // 4 decimales en millones (S/ 100) y un mínimo para que los saldos pequeños no queden en cero
    x.saldo > 0 ? Math.max(0.0001, +(x.saldo / 1e6).toFixed(4)) : 0,
    corto(x.nombre), titulo(x.dist || x.prov || ''), NIVEL[x.nivel] || 'L',
  ]);
}
writeFileSync(join(ROOT, 'web/data/obras_por_depto.json'), JSON.stringify(out));
const total = Object.values(out).reduce((s, l) => s + l.length, 0);
console.log(`obras_por_depto.json: ${total} obras en ${Object.keys(out).length} departamentos${sinLugar ? `, ${sinLugar} sin ubicación` : ''}`);
