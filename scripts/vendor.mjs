// Copia las dependencias del front a web/vendor (se versionan para que GitHub Pages sirva el sitio tal cual).
import { cpSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";

const out = "web/vendor";
mkdirSync(`${out}/fonts`, { recursive: true });
cpSync("node_modules/maplibre-gl/dist/maplibre-gl.js", `${out}/maplibre-gl.js`);
cpSync("node_modules/maplibre-gl/dist/maplibre-gl.css", `${out}/maplibre-gl.css`);
cpSync("node_modules/topojson-client/dist/topojson-client.min.js", `${out}/topojson-client.min.js`);

const faces = [
  ["Barlow", "barlow", [400, 500, 600], ["normal"]],
  ["Barlow", "barlow", [400], ["italic"]],
  ["Barlow Condensed", "barlow-condensed", [500, 600, 700, 800], ["normal"]],
];
let css = "/* Generado por scripts/vendor.mjs: subconjunto latin de Barlow (SIL OFL 1.1). */\n";
for (const [family, pkg, weights, styles] of faces) {
  for (const w of weights) for (const s of styles) {
    const file = `${pkg}-latin-${w}-${s}.woff2`;
    cpSync(`node_modules/@fontsource/${pkg}/files/${file}`, `${out}/fonts/${file}`);
    css += `@font-face{font-family:"${family}";font-style:${s};font-weight:${w};font-display:swap;src:url(fonts/${file}) format("woff2");}\n`;
  }
}
writeFileSync(`${out}/fonts.css`, css);
console.log("vendor listo:", readdirSync(out).join(", "));
