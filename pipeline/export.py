"""Exporta los marts de dbt (DuckDB) a JSON estático para la web.

La web es 100% estática (Netlify, sin backend ni base de datos en línea):
todo lo que muestra sale de estos archivos.

- obras.json    tabla de hechos en formato columnar compacto (cols + rows)
- resumen.json  cifras de portada (agg_resumen)
- meta.json     procedencia: informe, fecha de corte, hash del archivo, mapeo de columnas
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import duckdb

# columna en fct_obras -> clave corta en el JSON
FIELDS = {
    "codigo_infobras": "id",
    "cui": "cui",
    "nombre_obra": "nombre",
    "entidad": "entidad",
    "nivel_gobierno": "nivel",
    "sector": "sector",
    "modalidad_ejecucion": "modalidad",
    "causal_paralizacion": "causal",
    "ubigeo_departamento": "u_dep",
    "ubigeo_provincia": "u_prov",
    "ubigeo_distrito": "u_dist",
    "departamento": "dep",
    "provincia": "prov",
    "distrito": "dist",
    "geo_metodo": "geo",
    "costo_actualizado": "costo",
    "monto_ejecutado": "ejecutado",
    "saldo_por_ejecutar": "saldo",
    "avance_fisico": "avance",
    "fecha_paralizacion": "f_paral",
    "anios_paralizada": "anios",
}


def _clean(v):
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float):
        return round(v, 2)
    return v


def export(db_path: Path, out_dir: Path, meta_path: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path), read_only=True)

    cols = list(FIELDS)
    rows = con.execute(
        f"select {', '.join(cols)} from fct_obras order by saldo_por_ejecutar desc nulls last"
    ).fetchall()
    obras = {"cols": [FIELDS[c] for c in cols], "rows": [[_clean(v) for v in r] for r in rows]}
    (out_dir / "obras.json").write_text(json.dumps(obras, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    cur = con.execute("select * from agg_resumen")
    row = cur.fetchone()
    res = {d[0]: _clean(v) for d, v in zip(cur.description, row)}
    (out_dir / "resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")

    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    size_kb = (out_dir / "obras.json").stat().st_size / 1024
    print(f"obras.json: {len(rows)} filas, {size_kb:.0f} KB | resumen.json | meta.json -> {out_dir}")
