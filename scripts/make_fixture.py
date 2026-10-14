"""Genera un Excel SINTÉTICO con la forma del Anexo N.° 02 de la Contraloría.

Sirve para desarrollar y testear sin depender de gob.pe. Todo lo que genera es
inventado: las entidades se llaman "Entidad de ejemplo N" y cada obra lleva el
prefijo [EJEMPLO]. Nunca se publica como dato real: el pipeline lo marca con
`--sample` y la web muestra un aviso.

    python scripts/make_fixture.py data/raw/fixture_anexo02.xlsx --rows 900
"""
import argparse
import csv
import random
from datetime import date, timedelta
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]

CAUSALES = [
    ("Incumplimiento de contrato", 22), ("Falta de recursos financieros y liquidez", 24),
    ("Deficiencia en el expediente técnico", 11), ("Abandono de obra", 8),
    ("Discrepancias, controversias y arbitraje", 6), ("Eventos climáticos", 7),
    ("Conflictos sociales", 4), ("Disponibilidad de terreno", 3),
    ("Falta de permisos, licencias y autorizaciones", 3), ("Obra judicializada", 2), ("Otros", 10),
]
MODALIDADES = [("Administración directa", 50), ("Por Contrata", 44), ("Por núcleo ejecutor", 4), ("Obras por impuestos", 2)]
NIVELES = [("G. Local", 68), ("G. Regional", 15), ("G. Nacional", 17)]
SECTORES = [
    ("Transportes y Comunicaciones", 26), ("Vivienda, Construcción y Saneamiento", 23), ("Educación", 15),
    ("Agricultura y Riego", 10), ("Salud", 6), ("Interior", 3), ("Deporte", 7), ("Otros", 10),
]
TIPOS = [
    "Mejoramiento del servicio de agua potable y alcantarillado", "Creación del puente vehicular",
    "Mejoramiento de la transitabilidad vehicular y peatonal", "Mejoramiento del servicio educativo",
    "Creación del servicio de práctica deportiva", "Mejoramiento del canal de riego",
    "Mejoramiento de la capacidad resolutiva del centro de salud", "Creación de la losa multideportiva",
]
# Peso relativo por departamento (solo para que el mapa de prueba no sea uniforme).
PESO_DEP = {"CUSCO": 15, "PUNO": 10, "LIMA": 8, "ANCASH": 8, "CAJAMARCA": 6, "APURIMAC": 5, "AYACUCHO": 5}

HEADER = [
    "N°", "CÓDIGO INFOBRAS", "CUI", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "NIVEL DE GOBIERNO",
    "ENTIDAD", "SECTOR", "NOMBRE DE LA OBRA", "MODALIDAD DE EJECUCIÓN", "COSTO ACTUALIZADO (S/)",
    "MONTO EJECUTADO (S/)", "SALDO POR EJECUTAR (S/)", "% AVANCE FÍSICO", "FECHA DE PARALIZACIÓN",
    "CAUSAL DE PARALIZACIÓN",
]


def pick(rng, pairs):
    return rng.choices([p[0] for p in pairs], weights=[p[1] for p in pairs])[0]


def main(out: str, rows: int, seed: int) -> None:
    rng = random.Random(seed)
    ubigeos = list(csv.DictReader(open(ROOT / "dbt/seeds/dim_ubigeo.csv", encoding="utf-8")))
    weights = [PESO_DEP.get(u["departamento"].upper(), 2) for u in ubigeos]

    wb = Workbook()
    ws = wb.active
    ws.title = "BD Obras paralizadas"
    ws.append(["DATOS SINTÉTICOS DE PRUEBA - NO SON DATOS DE LA CONTRALORÍA"])
    ws.append(["Base de datos de obras públicas paralizadas (formato de ejemplo)"])
    ws.append([])
    ws.append(HEADER)

    for n in range(1, rows + 1):
        u = rng.choices(ubigeos, weights=weights)[0]
        nivel = pick(rng, NIVELES)
        costo = round(rng.lognormvariate(14.2, 1.3), 2)
        avance = round(min(99.9, max(0.5, rng.betavariate(2.2, 1.4) * 100)), 2)
        ejecutado = round(costo * min(1.0, avance / 100 * rng.uniform(0.85, 1.15)), 2)
        paraliz = date(2026, 6, 30) - timedelta(days=int(rng.expovariate(1 / 700)) + 180)
        dep = u["departamento"].upper()
        if dep == "CALLAO" and rng.random() < 0.5:
            dep = "PROVINCIA CONSTITUCIONAL DEL CALLAO"  # variante para testear normalización
        ws.append([
            n, 100000 + n, 2000000 + rng.randint(0, 999999), dep, u["provincia"].upper(), u["distrito"].upper(),
            nivel, f"ENTIDAD DE EJEMPLO {rng.randint(1, 400):03d}", pick(rng, SECTORES),
            f"[EJEMPLO] {rng.choice(TIPOS)} - obra sintética {n:04d}", pick(rng, MODALIDADES),
            costo, ejecutado, round(max(0.0, costo - ejecutado), 2), f"{avance}%",
            paraliz.strftime("%d/%m/%Y"), pick(rng, CAUSALES),
        ])

    ws.append([])
    ws.append(["TOTAL", None, None, None, None, None, None, None, None, None, None, None])
    ws.append(["Fuente: datos sintéticos generados por scripts/make_fixture.py"])
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(f"{rows} filas sintéticas -> {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--rows", type=int, default=900)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    main(a.out, a.rows, a.seed)
