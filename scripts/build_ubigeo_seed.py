"""Construye dbt/seeds/dim_ubigeo.csv a partir del GeoJSON distrital del INEI.

Una fila por distrito con su ubigeo y los nombres normalizados de distrito,
provincia y departamento, que es la llave con la que se cruzan las obras.
"""
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline.text import norm  # noqa: E402


SMALL = {"de", "del", "la", "las", "los", "y", "el"}


def title(s: str) -> str:
    """'SAN JUAN DE LURIGANCHO' -> 'San Juan de Lurigancho'."""
    words = s.lower().split()
    return " ".join(w if (i and w in SMALL) else w.capitalize() for i, w in enumerate(words))


def main(src: str, dst: str) -> None:
    features = json.loads(Path(src).read_text(encoding="utf-8"))["features"]
    rows = []
    for f in features:
        p = f["properties"]
        rows.append({
            "ubigeo": p["IDDIST"],
            "ubigeo_prov": p["IDPROV"],
            "ubigeo_dep": p["IDDPTO"],
            "distrito": title(p["NOMBDIST"]),
            "provincia": title(p["NOMBPROV"]),
            "departamento": title(p["NOMBDEP"]),
            "distrito_key": norm(p["NOMBDIST"]),
            "provincia_key": norm(p["NOMBPROV"]),
            "departamento_key": norm(p["NOMBDEP"]),
        })
    rows.sort(key=lambda r: r["ubigeo"])
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    with open(dst, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} distritos -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
