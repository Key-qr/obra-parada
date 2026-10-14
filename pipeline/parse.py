"""Parser del Anexo N.° 02 de la Contraloría (base de obras paralizadas).

La Contraloría no publica un esquema estable: el Excel cambia de nombre de
columnas, de hoja y de filas de título entre un informe y otro. Por eso el
parser no depende de posiciones fijas:

1. Recorre todas las hojas y, en cada una, las primeras filas buscando la que
   más se parece a una cabecera (la que más columnas canónicas reconoce).
2. Mapea cada cabecera a un campo canónico con reglas por regex sobre el texto
   normalizado (sin tildes, minúsculas).
3. Limpia montos, porcentajes y fechas en los formatos que usa el Estado.

Si un informe nuevo rompe el mapeo, se agrega el alias en FIELD_RULES y un
test en tests/test_parse.py; no se toca el resto del pipeline.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from pipeline.text import norm

# Campo canónico -> regex que se prueban (en orden) contra la cabecera normalizada.
FIELD_RULES: dict[str, list[str]] = {
    "codigo_infobras": [r"\bcodigo\b.*\binfobras\b", r"\binfobras\b", r"^cod obra$", r"^codigo de obra$"],
    "cui": [r"\bcui\b", r"codigo unico", r"\bcodigo de inversion\b", r"\bsnip\b"],
    "nombre_obra": [r"nombre de (la )?obra", r"^obra$", r"descripcion de (la )?obra", r"nombre de (la )?inversion", r"^nombre$"],
    "departamento": [r"^departamento$", r"^dpto$", r"^region$", r"departamento"],
    "provincia": [r"^provincia$", r"provincia"],
    "distrito": [r"^distrito$", r"distrito"],
    "ubigeo": [r"\bubigeo\b"],
    "nivel_gobierno": [r"nivel de gobierno", r"^nivel$", r"nivel gob"],
    "entidad": [r"^entidad$", r"entidad (publica|ejecutora|responsable)?", r"unidad ejecutora", r"^ue$"],
    "sector": [r"^sector$", r"sector"],
    "modalidad_ejecucion": [r"modalidad", r"tipo de ejecucion"],
    "costo_actualizado": [r"costo actualizado", r"monto actualizado", r"costo total", r"monto de inversion", r"costo de (la )?obra", r"monto contratado"],
    "monto_ejecutado": [r"(monto|inversion|costo) ejecutad", r"devengado", r"valorizado acumulado", r"monto valorizado"],
    "saldo_por_ejecutar": [r"saldo"],
    "avance_fisico": [r"avance fisico", r"avance real", r"^(porcentaje de |% )?avance( %)?$"],
    "fecha_paralizacion": [r"fecha de paralizacion", r"fecha paraliz", r"paralizada desde"],
    "fecha_inicio": [r"fecha de inicio", r"fecha inicio"],
    "causal_paralizacion": [r"causal", r"causa", r"motivo"],
    "evento_asociado": [r"evento"],
}

# Orden en que se prueban los campos: los más específicos primero, para que
# "Monto de inversión ejecutado" no caiga en costo_actualizado.
MATCH_ORDER = [
    "saldo_por_ejecutar", "monto_ejecutado", "costo_actualizado",
    "codigo_infobras", "cui", "fecha_paralizacion", "fecha_inicio",
    "nivel_gobierno", "modalidad_ejecucion", "causal_paralizacion", "evento_asociado",
    "avance_fisico", "ubigeo", "departamento", "provincia", "distrito",
    "nombre_obra", "entidad", "sector",
]
assert set(MATCH_ORDER) == set(FIELD_RULES)

REQUIRED = ["nombre_obra", "departamento"]
NUMERIC = ["costo_actualizado", "monto_ejecutado", "saldo_por_ejecutar"]
TEXT_UPPER = ["departamento", "provincia", "distrito", "entidad"]


@dataclass
class ParseResult:
    df: pd.DataFrame
    sheet: str
    header_row: int
    mapping: dict[str, str]          # cabecera original -> campo canónico
    unmapped: list[str]              # cabeceras que no se reconocieron
    sha256: str


def match_field(header) -> str | None:
    h = norm(header)
    if not h:
        return None
    for field in MATCH_ORDER:
        if any(re.search(p, h) for p in FIELD_RULES[field]):
            return field
    return None


def map_headers(headers: list) -> tuple[dict[str, str], list[str]]:
    """Asigna cada cabecera a un campo; cada campo se usa una sola vez (gana la primera)."""
    mapping: dict[str, str] = {}
    used: set[str] = set()
    unmapped: list[str] = []
    for h in headers:
        if h is None or (isinstance(h, float) and pd.isna(h)) or str(h).strip() == "":
            continue
        field = match_field(h)
        if field and field not in used:
            mapping[str(h)] = field
            used.add(field)
        else:
            unmapped.append(str(h))
    return mapping, unmapped


def find_header(raw: pd.DataFrame, scan_rows: int = 40) -> tuple[int, int]:
    """Devuelve (fila, puntaje) de la fila que más campos canónicos reconoce."""
    best_row, best_score = -1, 0
    for i in range(min(scan_rows, len(raw))):
        values = [v for v in raw.iloc[i].tolist() if isinstance(v, str)]
        mapping, _ = map_headers(values)
        score = len(mapping)
        if score > best_score:
            best_row, best_score = i, score
    return best_row, best_score


def to_number(value) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("S/", "").replace("s/", "").replace("%", "").replace(" ", "")
    if s in {"", "-", "--", "n/a", "N/A", "ND"}:
        return None
    if "," in s and "." in s:
        # El separador que aparece último es el decimal.
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # 1,234,567 (miles) vs 12,5 (decimal)
        s = s.replace(",", "") if re.fullmatch(r"-?\d{1,3}(,\d{3})+", s) else s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def to_date(series: pd.Series) -> pd.Series:
    def one(v):
        if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
            return pd.NaT
        if isinstance(v, (int, float)) and 20000 < v < 80000:  # serial de Excel
            return pd.Timestamp("1899-12-30") + pd.Timedelta(days=float(v))
        return pd.to_datetime(v, dayfirst=True, errors="coerce")
    return series.map(one)


def clean(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    for col in NUMERIC:
        if col in out:
            out[col] = out[col].map(to_number)

    if "avance_fisico" in out:
        av = out["avance_fisico"].map(to_number)
        # Algunas bases traen 0.65 y otras 65 para el mismo concepto.
        if av.dropna().size and av.dropna().quantile(0.95) <= 1.0:
            av = av * 100
        out["avance_fisico"] = av.clip(lower=0, upper=100)

    if {"costo_actualizado", "monto_ejecutado"} <= set(out) and "saldo_por_ejecutar" not in out:
        out["saldo_por_ejecutar"] = (out["costo_actualizado"] - out["monto_ejecutado"]).clip(lower=0)

    for col in ["fecha_paralizacion", "fecha_inicio"]:
        if col in out:
            out[col] = to_date(out[col]).dt.date

    for col in out.columns:
        if out[col].dtype == object and col not in NUMERIC + ["fecha_paralizacion", "fecha_inicio"]:
            out[col] = out[col].map(lambda v: re.sub(r"\s+", " ", str(v)).strip() if pd.notna(v) else None)

    for col in TEXT_UPPER:
        if col in out:
            out[col] = out[col].map(lambda v: v.upper() if isinstance(v, str) else v)

    if "ubigeo" in out:
        out["ubigeo"] = out["ubigeo"].map(
            lambda v: str(int(float(v))).zfill(6) if pd.notna(to_number(v)) else None
        )

    for col in ["codigo_infobras", "cui"]:
        if col in out:
            out[col] = out[col].map(lambda v: str(int(float(v))) if to_number(v) is not None else (v or None))

    # Filas de totales o notas al pie: sin nombre de obra o con "total" como departamento.
    out = out[out["nombre_obra"].notna() & (out["nombre_obra"].str.len() > 3)]
    out = out[~out["departamento"].fillna("").str.contains(r"^TOTAL", regex=True)]
    return out.reset_index(drop=True)


def parse_excel(path: str | Path) -> ParseResult:
    path = Path(path)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    sheets = pd.read_excel(path, sheet_name=None, header=None, dtype=object)

    best = None
    for name, raw in sheets.items():
        row, score = find_header(raw)
        if row < 0:
            continue
        candidate = (score, len(raw) - row, name, row)
        if best is None or candidate[:2] > best[:2]:
            best = candidate
    if best is None or best[0] < 4:
        raise ValueError(f"No encontré una cabecera reconocible en {path.name}. Revisa FIELD_RULES.")

    _, _, sheet, header_row = best
    raw = sheets[sheet]
    headers = raw.iloc[header_row].tolist()
    mapping, unmapped = map_headers([h for h in headers if isinstance(h, str)])
    missing = [f for f in REQUIRED if f not in mapping.values()]
    if missing:
        raise ValueError(f"Faltan columnas obligatorias {missing}. Cabeceras vistas: {headers}")

    body = raw.iloc[header_row + 1:].copy()
    body.columns = [str(h) if isinstance(h, str) else f"_col{i}" for i, h in enumerate(headers)]
    df = body[list(mapping.keys())].rename(columns=mapping)
    df = clean(df)
    # Contrato fijo hacia dbt: siempre las mismas columnas, aunque el informe no traiga alguna.
    for col in FIELD_RULES:
        if col not in df:
            df[col] = None
    df = df[list(FIELD_RULES)]
    return ParseResult(df=df, sheet=str(sheet), header_row=int(header_row), mapping=mapping, unmapped=unmapped, sha256=sha)
