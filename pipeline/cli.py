"""Punto de entrada del pipeline.

    python -m pipeline.cli ingest                     # descubre y descarga lo último de gob.pe
    python -m pipeline.cli ingest --file anexo.xlsx --corte 2026-06
    python -m pipeline.cli ingest --url https://...xlsx --corte 2026-06
    python -m pipeline.cli export                     # marts de dbt -> web/data/*.json

Flujo completo: ingest -> dbt build -> export (ver Makefile).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
STAGING = ROOT / "data" / "staging"
WEB_DATA = ROOT / "web" / "data"


def cmd_ingest(args) -> int:
    from pipeline.parse import empty_control, parse_control, parse_excel

    source_url, title = args.url, None
    control_path = Path(args.control_file) if args.control_file else None
    if args.file:
        path = Path(args.file)
    elif args.url:
        import requests

        from pipeline.fetch import download
        with requests.Session() as s:
            path = download(s, args.url, RAW_DIR)
            if args.control_url:
                control_path = download(s, args.control_url, RAW_DIR)
    else:
        from pipeline.fetch import fetch_latest
        path, control_path, pub = fetch_latest(RAW_DIR)
        source_url, title = pub.url, pub.title
        args.corte = args.corte or pub.corte

    result = parse_excel(path)
    df = result.df
    STAGING.mkdir(parents=True, exist_ok=True)
    df.to_parquet(STAGING / "obras.parquet", index=False)

    # La base de servicios de control es opcional: sin ella se escribe una tabla vacía
    # con el mismo esquema, para que dbt corra igual.
    control_meta = None
    if control_path:
        ctrl = parse_control(control_path)
        ctrl.df.to_parquet(STAGING / "control.parquet", index=False)
        control_meta = {
            "archivo": control_path.name, "sha256": ctrl.sha256, "hoja": ctrl.sheet,
            "fila_cabecera": ctrl.header_row, "columnas": ctrl.mapping,
            "columnas_no_mapeadas": ctrl.unmapped, "filas": len(ctrl.df),
        }
        print(f"{len(ctrl.df)} servicios de control leídos de '{control_path.name}'")
    else:
        empty_control().to_parquet(STAGING / "control.parquet", index=False)

    meta = {
        "corte": args.corte,
        "fuente": "Contraloría General de la República - Informe de obras paralizadas en el territorio nacional",
        "publicacion": title,
        "url": source_url,
        "archivo": path.name,
        "sha256": result.sha256,
        "hoja": result.sheet,
        "fila_cabecera": result.header_row,
        "columnas": result.mapping,
        "columnas_no_mapeadas": result.unmapped,
        "filas": len(df),
        "control": control_meta,
        "es_muestra": bool(args.sample),
        "procesado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (STAGING / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{len(df)} obras leídas de '{path.name}' (hoja '{result.sheet}', cabecera en fila {result.header_row + 1})")
    print("Mapeo:", json.dumps(result.mapping, ensure_ascii=False))
    if result.unmapped:
        print("Sin mapear:", result.unmapped)
    return 0


def cmd_export(args) -> int:
    from pipeline.export import export
    export(ROOT / args.db, WEB_DATA, STAGING / "meta.json")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="obra-parada")
    sub = p.add_subparsers(dest="cmd", required=True)

    i = sub.add_parser("ingest", help="descarga/lee el Anexo 01 y lo deja en data/staging")
    src = i.add_mutually_exclusive_group()
    src.add_argument("--file", help="Excel ya descargado")
    src.add_argument("--url", help="enlace directo al Excel")
    i.add_argument("--control-file", help="Excel de servicios de control ya descargado (opcional)")
    i.add_argument("--control-url", help="enlace directo al Excel de servicios de control (con --url)")
    i.add_argument("--corte", help="fecha de corte del informe, AAAA-MM")
    i.add_argument("--sample", action="store_true", help="marca los datos como de ejemplo")
    i.set_defaults(func=cmd_ingest)

    e = sub.add_parser("export", help="exporta los marts de dbt a JSON para la web")
    e.add_argument("--db", default="data/warehouse.duckdb")
    e.set_defaults(func=cmd_export)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
