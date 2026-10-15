// Búsqueda de obras por lo que son y por dónde están.
// La gente escribe "calles de Huanchaco" o "puente Iquitos"; en Infobras la obra se llama
// "MEJORAMIENTO DE LA TRANSITABILIDAD VEHICULAR Y PEATONAL EN LOS JIRONES…". Por eso cada
// palabra se busca junto con sus equivalentes, en el nombre, la entidad y el lugar de la obra.

const STOP = new Set("de del la las el los en y a al para con por que un una unos unas obra obras proyecto quiero ver busco buscar sobre".split(" "));

// Raíz de lo que escribe la gente -> raíces de cómo aparece en los nombres oficiales.
const GRUPOS = [
  [["calle", "pista", "vereda", "jiron", "avenida", "pavimen", "asfalt", "vias", "vial", "transitab"],
    ["calle", "pista", "vereda", "jiron", "avenida", "pavimen", "asfalt", "vias", "vial", "transitabilidad"]],
  [["remodel", "arregl", "mejora", "rehabilit", "renov", "reconstr"],
    ["remodel", "mejoramiento", "rehabilitacion", "renovacion", "reconstruccion", "recuperacion", "reparacion", "mantenimiento"]],
  [["colegio", "escuela", "educa", "aula", "inicial", "primaria", "secundaria", "jardin", "institucion educativa"],
    ["colegio", "escuela", "educativ", "educacion", "aula", "inicial", "primaria", "secundaria", "jardin"]],
  [["posta", "salud", "hospital", "clinica", "centro de salud", "puesto de salud"],
    ["posta", "salud", "hospital", "clinica", "puesto de salud", "centro de salud"]],
  [["agua", "potable", "sanea", "desague", "alcantar", "excreta"],
    ["agua", "potable", "saneamiento", "desague", "alcantarillado", "excretas", "residuales"]],
  [["luz", "electri", "energia", "alumbrado"], ["electrific", "electric", "energia", "alumbrado"]],
  [["carretera", "camino", "trocha", "via vecinal", "pista rural"], ["carretera", "camino", "trocha", "vecinal", "carrozable", "interurbana", "vial"]],
  [["puente", "ponton"], ["puente", "ponton"]],
  [["riego", "canal", "reservorio", "represa", "irriga", "bocatoma"], ["riego", "canal", "reservorio", "represa", "irrigacion", "bocatoma"]],
  [["estadio", "losa", "cancha", "deport", "coliseo", "piscina"], ["estadio", "losa", "cancha", "deportiv", "coliseo", "piscina", "recreacion"]],
  [["parque", "plaza", "malecon", "area verde"], ["parque", "plaza", "malecon", "area verde", "recreacion", "espacios publicos"]],
  [["mercado", "abasto"], ["mercado", "abasto", "comercializacion"]],
  [["comisaria", "policia", "seguridad", "serenazgo"], ["comisaria", "policia", "policial", "seguridad", "serenazgo"]],
  [["municipal", "municipio", "palacio"], ["municipal", "municipio", "palacio"]],
  [["defensa riberena", "rio", "huaico", "inundacion"], ["defensa", "riberena", "proteccion", "encauzamiento", "rio"]],
];

export const normaliza = (s) => " " + String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";

// Palabras de la consulta, sin las que no ayudan a buscar.
export function palabras(q) {
  return normaliza(q).trim().split(" ").filter((w) => w.length > 1 && !STOP.has(w));
}

// La palabra tal cual y en singular: "calles" -> "calle", "puentes" -> "puente".
function propias(w) {
  const out = [w];
  if (w.length > 5 && w.endsWith("es")) out.push(w.slice(0, -2));
  if (w.length >= 4 && w.endsWith("s")) out.push(w.slice(0, -1));
  return out;
}
// El grupo de equivalentes al que pertenece una palabra, si tiene uno.
function grupo(w) {
  if (w.length < 4) return null;
  return GRUPOS.find(([gente]) => gente.some((g) => w.startsWith(g) || g.startsWith(w))) || null;
}
// Para una palabra, todas las formas con las que puede aparecer.
function formas(w) {
  const g = grupo(w);
  return [...new Set([...propias(w), ...(g ? g[1] : [])])];
}

// Coincide si alguna forma aparece al inicio de una palabra del texto.
const aparece = (texto, fs) => fs.some((f) => texto.includes(" " + f));

export function crearIndice(obras) {
  return obras.map((o) => ({
    o,
    nombre: normaliza(o.nombre),
    entidad: normaliza(o.entidad),
    lugar: normaliza([o.dist, o.prov, o.dep].filter(Boolean).join(" ")),
    codigos: ` ${o.id ?? ""} ${o.cui ?? ""} `,
  }));
}

// Devuelve { obras, aviso, lugarSolo } ordenadas: primero las que calzan en el nombre, luego por dinero pendiente.
export function buscarObras(indice, q, limite = 60) {
  const ws = palabras(q);
  if (!ws.length) return { obras: [], total: 0, aviso: "" };
  const fs = ws.map(formas);

  // Un número largo es un código Infobras o un CUI.
  const cod = ws.find((w) => /^\d{5,}$/.test(w));
  if (cod) {
    const r = indice.filter((x) => x.codigos.includes(` ${cod} `)).map((x) => x.o);
    if (r.length) return { obras: r, total: r.length, aviso: "" };
  }

  const res = [];
  for (const x of indice) {
    let puntos = 0, ok = true;
    for (let i = 0; i < ws.length; i++) {
      const enNombre = aparece(x.nombre, fs[i]);
      const enLugar = aparece(x.lugar, [ws[i]]);
      const enEntidad = aparece(x.entidad, [ws[i]]);
      if (!enNombre && !enLugar && !enEntidad) { ok = false; break; }
      puntos += (enNombre ? 3 : 0) + (enLugar ? 2 : 0) + (enEntidad ? 1 : 0) + (aparece(x.nombre, propias(ws[i])) ? 2 : 0) + (x.lugar.includes(` ${ws[i]} `) ? 2 : 0);
    }
    if (ok) res.push({ o: x.o, puntos });
  }
  res.sort((a, b) => b.puntos - a.puntos || (b.o.saldo || 0) - (a.o.saldo || 0));
  if (res.length) return { obras: res.slice(0, limite).map((r) => r.o), total: res.length, aviso: "" };

  // Nada calza con todo: si una parte es un lugar, se muestra lo que hay en ese lugar y se avisa.
  // Las palabras con equivalentes ("calles", "puente", "colegio") son el tema; las demás que nombran un lugar, el lugar.
  const deLugar = ws.filter((w) => !grupo(w) && w.length >= 3 && indice.some((x) => x.lugar.includes(` ${w}`)));
  const tema = ws.filter((w) => !deLugar.includes(w));
  if (deLugar.length && tema.length) {
    const r = indice.filter((x) => deLugar.every((w) => x.lugar.includes(` ${w}`)) || deLugar.every((w) => x.nombre.includes(` ${w}`)))
      .map((x) => ({ o: x.o, exacto: deLugar.every((w) => x.lugar.includes(` ${w} `)) }))
      .sort((a, b) => b.exacto - a.exacto || (b.o.saldo || 0) - (a.o.saldo || 0)).map((r) => r.o);
    if (r.length) {
      return { obras: r.slice(0, limite), total: r.length, lugarSolo: true,
        aviso: `Ninguna obra paralizada de “${tema.join(" ")}” ahí. Estas son las que hay:` };
    }
  }
  return { obras: [], total: 0, aviso: "" };
}
