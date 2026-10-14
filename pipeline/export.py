"""Exporta los marts de dbt (DuckDB) a JSON estático para la web.

La web es 100% estática (Netlify, sin backend ni base de datos en línea):
todo lo que muestra sale de estos archivos.

- obras.json    tabla de hechos en formato columnar compacto (cols + rows)
- resumen.json  cifras de portada (agg_resumen)
- meta.json     procedencia: informe, fecha de corte, hash del archivo, mapeo de columnas
"""
from __future__ import annotations

import json
import re
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
    "anio_inicio": "ini",
    "antiguedad_anios": "antig",
    "plazo_dias": "plazo",
    "evento": "evento",
    "tipo_obra_1": "tipo1",
    "tipo_obra_2": "tipo2",
    "tipo_obra_3": "tipo3",
    "pim_anual": "pim",
    "tiene_pim": "con_pim",
    "en_inventario_mef": "inv_mef",
    "en_lista_priorizada": "prior",
    "url_informe_situacional": "url_sit",
    "url_resolucion_priorizada": "url_res",
    "n_controles": "nctrl",
}

# Servicios de control (fct_control) -> control.json
CONTROL_FIELDS = {
    "codigo_infobras": "id",
    "tipo_control": "tipo",
    "tipo_accion": "accion",
    "entidad_auditada": "entidad",
    "anio_emision": "anio",
    "tipo_organo": "organo_tipo",
    "organo_auditor": "organo",
    "servicio": "servicio",
    "numero_informe": "num",
    "titulo_informe": "titulo",
    "url_informe": "url",
    "url_resumen": "url_res",
}


def _clean(v):
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float):
        return round(v, 2)
    return v


def dbt_summary(run_results: Path) -> dict | None:
    """Resume el último `dbt build` (modelos y tests) para mostrarlo en la web."""
    if not run_results.exists():
        return None
    rr = json.loads(run_results.read_text(encoding="utf-8"))
    out = {"modelos": [], "seeds": 0, "tests": {"pass": 0, "warn": 0, "error": 0, "fail": 0}, "segundos": round(rr.get("elapsed_time", 0), 2)}
    for r in rr.get("results", []):
        kind, name = r["unique_id"].split(".")[0], r["unique_id"].split(".")[-1]
        if kind == "model":
            out["modelos"].append({"nombre": name, "estado": r["status"], "segundos": round(r.get("execution_time", 0), 2)})
        elif kind == "seed":
            out["seeds"] += 1
        elif kind == "test":
            out["tests"][r["status"]] = out["tests"].get(r["status"], 0) + 1
    return out


def export(db_path: Path, out_dir: Path, meta_path: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path), read_only=True)

    cols = list(FIELDS)
    rows = con.execute(
        f"select {', '.join(cols)} from fct_obras order by saldo_por_ejecutar desc nulls last"
    ).fetchall()
    obras = {"cols": [FIELDS[c] for c in cols], "rows": [[_clean(v) for v in r] for r in rows]}
    (out_dir / "obras.json").write_text(json.dumps(obras, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    crow = con.execute(
        f"select {', '.join(CONTROL_FIELDS)} from fct_control order by anio_emision desc nulls last, control_sk"
    ).fetchall()
    ctrl = {"cols": list(CONTROL_FIELDS.values()), "rows": [[_clean(v) for v in r] for r in crow]}
    # Los PDF del SPIC siguen un patrón fijo: se guarda solo el código y la web arma
    # la URL (ahorra ~0.5 MB). Si una URL no sigue el patrón, se guarda completa.
    iu, ir = ctrl["cols"].index("url"), ctrl["cols"].index("url_res")
    spic = re.compile(r"^https?://apps8\.contraloria\.gob\.pe/SPIC/srvDownload/ViewPDF\?CRES_CODIGO=([^&]+)&TIPOARCHIVO=(ADJUNTO|RE)$")
    for r in ctrl["rows"]:
        mi = spic.match(r[iu] or "")
        mr = spic.match(r[ir] or "")
        if mi and mr and mi.group(1) == mr.group(1):
            r[iu], r[ir] = f"spic:{mi.group(1)}", None
        elif mi:
            r[iu] = f"spic:{mi.group(1)}"
    (out_dir / "control.json").write_text(json.dumps(ctrl, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    cur = con.execute("select * from agg_resumen")
    row = cur.fetchone()
    res = {d[0]: _clean(v) for d, v in zip(cur.description, row)}
    (out_dir / "resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")

    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    meta["dbt"] = dbt_summary(db_path.parent.parent / "dbt" / "target" / "run_results.json")
    (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    size_kb = (out_dir / "obras.json").stat().st_size / 1024
    ckb = (out_dir / "control.json").stat().st_size / 1024
    print(f"obras.json: {len(rows)} filas, {size_kb:.0f} KB | control.json: {len(crow)} filas, {ckb:.0f} KB | resumen.json | meta.json -> {out_dir}")
