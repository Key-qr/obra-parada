#!/usr/bin/env bash
# Descarga los límites del INEI (vía juaneladio/peru-geojson), los simplifica
# y deja solo las propiedades que usa la web. Genera además el seed de ubigeos
# que dbt usa para geolocalizar cada obra.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/data/raw/geo"
OUT="$ROOT/web/data/geo"
BASE="https://raw.githubusercontent.com/juaneladio/peru-geojson/master"

mkdir -p "$RAW" "$OUT"

for f in peru_departamental_simple peru_provincial_simple peru_distrital_simple; do
  [ -s "$RAW/$f.geojson" ] || curl -sSL -o "$RAW/$f.geojson" "$BASE/$f.geojson"
done

mapshaper "$RAW/peru_departamental_simple.geojson" \
  -each 'ubigeo=FIRST_IDDP, nombre=NOMBDEP' \
  -filter-fields ubigeo,nombre \
  -simplify 25% keep-shapes \
  -o "$OUT/departamentos.json" format=topojson precision=0.0001

mapshaper "$RAW/peru_provincial_simple.geojson" \
  -each 'ubigeo=FIRST_IDPR, nombre=NOMBPROV, departamento=FIRST_NOMB' \
  -filter-fields ubigeo,nombre,departamento \
  -simplify 15% keep-shapes \
  -o "$OUT/provincias.json" format=topojson precision=0.0001

mapshaper "$RAW/peru_distrital_simple.geojson" \
  -each 'ubigeo=IDDIST, nombre=NOMBDIST, provincia=NOMBPROV, departamento=NOMBDEP' \
  -filter-fields ubigeo,nombre,provincia,departamento \
  -simplify 12% keep-shapes \
  -o "$OUT/distritos.json" format=topojson precision=0.0001

python3 "$ROOT/scripts/build_ubigeo_seed.py" "$RAW/peru_distrital_simple.geojson" "$ROOT/dbt/seeds/dim_ubigeo.csv"

ls -lh "$OUT"
