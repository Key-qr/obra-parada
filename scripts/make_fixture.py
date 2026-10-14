"""Genera Excel SINTÉTICOS con la forma de los anexos de la Contraloría.

- Anexo N.° 01: lista de obras paralizadas (mismas columnas que el informe de junio de 2026).
- Anexo N.° 02: servicios de control hechos a esas obras (opcional, con --control).

Sirven para desarrollar y testear sin depender de gob.pe. Todo es inventado:
las entidades se llaman "Entidad de ejemplo N", cada obra lleva el prefijo
[EJEMPLO] y los informes no tienen URL. El pipeline los marca con `--sample`
y la web muestra un aviso.

    python scripts/make_fixture.py data/raw/fixture_anexo01.xlsx --control data/raw/fixture_anexo02.xlsx --rows 900
"""
import argparse
import csv
import random
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]

# Causales con el número de catálogo que antepone la Contraloría.
CAUSALES = [
    ("2 INCUMPLIMIENTO DE CONTRATO", 22), ("6 FALTA DE RECURSOS FINANCIEROS Y LIQUIDEZ", 24),
    ("3 DEFICIENCIAS EN EL EXPEDIENTE TÉCNICO", 11), ("1 ABANDONO DE OBRA", 8),
    ("4 DISCREPANCIAS, CONTROVERSIAS Y ARBITRAJE", 6), ("9 EVENTOS CLIMÁTICOS", 7),
    ("8 CONFLICTOS SOCIALES", 4), ("10 DISPONIBILIDAD DE TERRENO", 3), ("15 OTROS", 10),
]
MODALIDADES = [("Administración directa", 50), ("Contrata", 46), ("Núcleo ejecutor", 4)]
NIVELES = [("G. LOCAL", 68), ("G. REGIONAL", 15), ("G. NACIONAL", 17)]
# (sector, tipo nivel 1, tipo nivel 2, tipo nivel 3, nombre)
TIPOS = [
    ("TRANSPORTES Y COMUNICACIONES", "Transporte", "Transporte Terrestre", "Caminos Vecinales", "Mejoramiento de la transitabilidad vehicular y peatonal", 26),
    ("VIVIENDA CONSTRUCCIÓN Y SANEAMIENTO", "Vivienda, Construcción Y Saneamiento", "Saneamiento Urbano Y Rural", "Abastecimiento De Agua Potable", "Mejoramiento del servicio de agua potable y alcantarillado", 23),
    ("EDUCACIÓN", "Educación", "Educación Básica", "Infraestructura Educativa", "Mejoramiento del servicio educativo", 15),
    ("AGRICULTURA", "Agricultura", "Riego", "Otra Infraestructura", "Mejoramiento del canal de riego", 10),
    ("SALUD", "Salud", "Atención Médica", "Establecimiento De Salud", "Mejoramiento de la capacidad resolutiva del centro de salud", 6),
    ("DEPORTE", "Deporte", "Deporte Y Recreación", "Losas Deportivas", "Creación del servicio de práctica deportiva", 7),
    ("OTROS", "Otros", "Otra Infraestructura", "Otros", "Creación del puente vehicular", 10),
]
PESO_DEP = {"CUSCO": 15, "PUNO": 10, "LIMA": 8, "ANCASH": 8, "CAJAMARCA": 6, "APURIMAC": 5, "AYACUCHO": 5}

HEADER_OBRAS = [
    "N°", "CODIGO INFOBRAS", "CUI", "DESCRIPCION DE INVERSION", "SNIP", "DESCRIPCION OBRA", "ENTIDAD", "EVENTO",
    "MODALIDAD DE EJECUCIÓN", "COSTO DE OBRA SEGÚN EXP. TEC.\n(Según INFOBRAS S/)",
    "SALDO DE OBRA\n(Costo de obra - Avance Valorizado)", "COSTO ACTUALIZADO\n(Según INVIERTE S/)",
    "RANGO DE INVERSION\n(mlls.)", "SALDO DE LA INVERSIÓN\n(Según INVIERTE S/)", "PIM 2026", "TIENE PIM 2026",
    "TIPO DE OBRA", "TIPO DE OBRA (Nivel 2)", "TIPO DE OBRA (Nivel 3)", "DEPARTAMENTO", "PROVINCIA", "DISTRITO",
    "AÑO INICIO OBRA", "PLAZO DE EJECUCIÓN", "AVANCE FÍSICO", "RANGO AVANCE FÍSICO", "NIVEL DE GOBIERNO", "SECTOR",
    "CAUSAL PARALIZACION", "UNIDAD ORGÁNICA", "ESTA EN EL INVENTARIO OBRAS PARALIZADAS MEF",
    "FECHA DE REGISTRO EN EL INVENTARIO", "CUENTA CON INFORME DE ESTADO SITUACIONAL", "FECHA INFORME SITUACIONAL",
    "URL INFORME", "DENTRO DE LA LISTA PRIORIZADA", "FECHA RESOLUCION DE LISTA PRIORIZADA", "URL RESOLUCION",
]
HEADER_CONTROL = [
    "N°", "CODIGO INFOBRAS", "CUI", "CODIGO SNIP", "OBRA", "DEPARTAMENTO OBRA", "TIPO_CONTROL", "TIPO_ACCION",
    "COD ENTIDAD AUDITADA", "ENTIDAD AUDITADA", "AÑO EMISION", "TIPO ORGANO", "ORGANO AUDITOR",
    "NOMBRE SERVICIO CONTROL", "ESTADO SERVICIO DE CONTROL", "NIVEL GOBIERNO", "NUMERO INFORME", "TITULO INFORME",
    "URL SPIC INFORME", "URL SPIC RESUMEN",
]
CONTROLES = [
    ("Control Simultáneo", "CONTROL CONCURRENTE", 47), ("Control Simultáneo", "ORIENTACIÓN DE OFICIO", 38),
    ("Control Simultáneo", "VISITA DE CONTROL", 6), ("Control Posterior", "AUDITORIA DE CUMPLIMIENTO", 4),
    ("Control Previo", "EVALUACION DE PRESUPUESTOS ADICIONALES DE OBRA", 2), ("Control Simultáneo", "ACCION SIMULTANEA", 3),
]


def pick(rng, pairs):
    return rng.choices([p[0] for p in pairs], weights=[p[-1] for p in pairs])[0]


def obras(out: str, rows: int, rng: random.Random) -> list[dict]:
    ubigeos = list(csv.DictReader(open(ROOT / "dbt/seeds/dim_ubigeo.csv", encoding="utf-8")))
    weights = [PESO_DEP.get(u["departamento"].upper(), 2) for u in ubigeos]
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"
    # Filas de título encima de la cabecera: el parser tiene que encontrarla igual.
    ws.append(["DATOS SINTÉTICOS DE PRUEBA - NO SON DATOS DE LA CONTRALORÍA"])
    ws.append([])
    ws.append(HEADER_OBRAS)
    hechas = []
    for n in range(1, rows + 1):
        u = rng.choices(ubigeos, weights=weights)[0]
        sector, t1, t2, t3, nombre, _ = rng.choices(TIPOS, weights=[t[-1] for t in TIPOS])[0]
        costo = round(rng.lognormvariate(14.2, 1.3), 2)
        avance = round(min(99.9, max(0.0, rng.betavariate(2.2, 1.4) * 100)), 2)
        saldo = round(max(0.0, costo * (1 - avance / 100 * rng.uniform(0.85, 1.15))), 2)
        tiene_pim = rng.random() < 0.33
        pim = round(saldo * rng.uniform(0.05, 0.5), 2) if tiene_pim else 0
        en_mef = rng.random() < 0.55
        prior = en_mef and rng.random() < 0.12
        dep = u["departamento"].upper()
        if dep == "CALLAO" and rng.random() < 0.5:
            dep = "PROVINCIA CONSTITUCIONAL DEL CALLAO"  # variante para testear normalización
        codigo = 100000 + n
        titulo = f"[EJEMPLO] {nombre} - obra sintética {n:04d}"
        ws.append([
            n, codigo, 2000000 + rng.randint(0, 999999), titulo.upper(), None, titulo.upper(),
            f"ENTIDAD DE EJEMPLO {rng.randint(1, 400):03d}", rng.choice(["Proceso Normal"] * 9 + ["Reconstrucción con Cambios"]),
            pick(rng, MODALIDADES), round(costo * rng.uniform(0.6, 1.0)), None, costo, None, saldo, pim,
            "SI" if tiene_pim else "NO", t1, t2, t3, dep, u["provincia"].upper(), u["distrito"].upper(),
            rng.randint(2006, 2025), rng.choice([90, 120, 150, 180, 240, 360, 540]), avance, None,
            pick(rng, NIVELES), sector, pick(rng, CAUSALES), "SUBGERENCIA DE EJEMPLO",
            "SI" if en_mef else "NO", None, "SI" if en_mef else "NO", None, None, "SI" if prior else "NO", None, None,
        ])
        hechas.append({"codigo": codigo, "nombre": titulo.upper(), "dep": dep})
    ws.append([])
    ws.append(["TOTAL"])
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(f"{rows} obras sintéticas -> {out}")
    return hechas


def control(out: str, hechas: list[dict], rng: random.Random) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Hoja1"
    ws.append(HEADER_CONTROL)
    n = 0
    for o in hechas:
        # Poco más de la mitad de las obras tiene al menos un control.
        if rng.random() > 0.55:
            continue
        for _ in range(1 + int(rng.expovariate(0.6))):
            n += 1
            tipo = rng.choices(CONTROLES, weights=[c[-1] for c in CONTROLES])[0]
            anio = rng.randint(2017, 2026)
            ws.append([
                n, o["codigo"], None, None, o["nombre"], o["dep"], tipo[0], tipo[1], None,
                f"ENTIDAD DE EJEMPLO {rng.randint(1, 400):03d}", anio,
                rng.choice(["Contraloria General", "Organo de Control Institucional"]), "ÓRGANO DE CONTROL DE EJEMPLO",
                f"[EJEMPLO] {tipo[1].capitalize()} a la obra {o['codigo']}", "Concluida", "GOBIERNO LOCAL",
                f"{n:05d}-{anio}-EJEMPLO", f"[EJEMPLO] Informe de {tipo[1].lower()} n.° {n}", None, None,
            ])
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(f"{n} servicios de control sintéticos -> {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out", help="Excel de obras (Anexo N.° 01)")
    ap.add_argument("--control", help="Excel de servicios de control (Anexo N.° 02)")
    ap.add_argument("--rows", type=int, default=900)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    hechas = obras(a.out, a.rows, rng)
    if a.control:
        control(a.control, hechas, rng)
