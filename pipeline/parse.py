"""Parsers de las bases de la Contraloría que acompañan al informe de obras paralizadas.

- Lista de obras paralizadas (Anexo N.° 01 en el informe a junio de 2026).
- Servicios de control efectuados a esas obras (Anexo N.° 02).

La Contraloría no publica un esquema estable: el Excel cambia de nombre de
columnas, de hoja, de filas de título y hasta de número de anexo entre un
informe y otro. Por eso el parser no depende de posiciones fijas:

1. Recorre todas las hojas y, en cada una, las primeras filas buscando la que
   más se parece a una cabecera (la que más columnas canónicas reconoce).
2. Mapea cabeceras a campos canónicos con reglas regex sobre el texto
   normalizado (sin tildes, minúsculas). Para cada campo se prueba una lista de
   patrones en orden de preferencia: si un informe trae "Costo de obra según
   expediente" y "Costo actualizado", gana el que la regla prefiere, no el que
   aparece primero.
3. Limpia montos, porcentajes, años, fechas y banderas SI/NO.

Si un informe nuevo rompe el mapeo, se agrega el patrón a la regla y un test en
tests/test_parse.py; no se toca el resto del pipeline.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from pipeline.text import norm


@dataclass
class Schema:
    rules: dict[str, list[str]]       # campo -> patrones en orden de preferencia
    order: list[str]                  # orden en que los campos eligen cabecera
    required: list[str]
    numeric: list[str] = field(default_factory=list)
    integer: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)      # SI/NO -> bool
    dates: list[str] = field(default_factory=list)
    upper: list[str] = field(default_factory=list)
    ids: list[str] = field(default_factory=list)
    min_score: int = 4


# ---------- lista de obras ----------
OBRAS = Schema(
    rules={
        "codigo_infobras": [r"\bcodigo\b.*\binfobras\b", r"\binfobras\b", r"^cod obra$", r"^codigo de obra$"],
        "cui": [r"\bcui\b", r"codigo unico", r"\bcodigo de inversion\b"],
        "nombre_obra": [r"^descripcion (de (la )?)?obra$", r"nombre de (la )?obra", r"^obra$", r"descripcion (de (la )?)?obra", r"nombre de (la )?inversion", r"^nombre$"],
        "departamento": [r"^departamento$", r"^dpto$", r"^region$", r"departamento"],
        "provincia": [r"^provincia$", r"provincia"],
        "distrito": [r"^distrito$", r"distrito"],
        "ubigeo": [r"\bubigeo\b"],
        "nivel_gobierno": [r"nivel de gobierno", r"^nivel$", r"nivel gob"],
        "entidad": [r"^entidad$", r"^entidad (publica|ejecutora|responsable)", r"unidad ejecutora", r"^ue$"],
        "sector": [r"^sector$", r"\bsector\b"],
        "modalidad_ejecucion": [r"modalidad", r"tipo de ejecucion"],
        "costo_actualizado": [r"costo actualizado", r"monto actualizado", r"costo total", r"monto de inversion", r"costo de (la )?obra", r"monto contratado"],
        "monto_ejecutado": [r"(monto|inversion|costo) ejecutad", r"devengado", r"valorizado acumulado", r"monto valorizado"],
        # El saldo que va con el costo actualizado es el de la inversión (Invierte.pe).
        "saldo_por_ejecutar": [r"saldo de (la )?inversion", r"saldo por ejecutar", r"^saldo"],
        "avance_fisico": [r"^avance fisico", r"avance fisico", r"avance real", r"^(porcentaje de |% )?avance( %)?$"],
        "fecha_paralizacion": [r"fecha de paralizacion", r"fecha paraliz", r"paralizada desde"],
        "fecha_inicio": [r"fecha de inicio", r"fecha inicio"],
        "anio_inicio": [r"ano (de )?inicio", r"anio (de )?inicio"],
        "plazo_dias": [r"plazo de ejecucion", r"^plazo"],
        "causal_paralizacion": [r"causal", r"causa", r"motivo"],
        "evento_asociado": [r"^evento", r"evento"],
        "tipo_obra_1": [r"^tipo de obra$"],
        "tipo_obra_2": [r"^tipo de obra nivel 2$"],
        "tipo_obra_3": [r"^tipo de obra nivel 3$"],
        "pim_anual": [r"^pim( \d{4})?$"],
        "tiene_pim": [r"^tiene pim"],
        "en_inventario_mef": [r"^esta en el inventario", r"inventario obras paralizadas"],
        "tiene_informe_situacional": [r"informe de estado situacional"],
        "url_informe_situacional": [r"^url informe$", r"url informe situacional"],
        "en_lista_priorizada": [r"^dentro de la lista priorizada", r"^en (la )?lista priorizada"],
        "url_resolucion_priorizada": [r"^url resolucion"],
    },
    order=[
        "saldo_por_ejecutar", "monto_ejecutado", "costo_actualizado",
        "codigo_infobras", "cui", "fecha_paralizacion", "fecha_inicio", "anio_inicio", "plazo_dias",
        "tipo_obra_2", "tipo_obra_3", "tipo_obra_1",
        "pim_anual", "tiene_pim", "en_inventario_mef", "tiene_informe_situacional", "url_informe_situacional",
        "en_lista_priorizada", "url_resolucion_priorizada",
        "nivel_gobierno", "modalidad_ejecucion", "causal_paralizacion", "evento_asociado",
        "avance_fisico", "ubigeo", "departamento", "provincia", "distrito",
        "nombre_obra", "entidad", "sector",
    ],
    required=["nombre_obra", "departamento"],
    numeric=["costo_actualizado", "monto_ejecutado", "saldo_por_ejecutar", "pim_anual"],
    integer=["anio_inicio", "plazo_dias"],
    flags=["tiene_pim", "en_inventario_mef", "tiene_informe_situacional", "en_lista_priorizada"],
    dates=["fecha_paralizacion", "fecha_inicio"],
    upper=["departamento", "provincia", "distrito", "entidad"],
    ids=["codigo_infobras", "cui"],
)

# ---------- servicios de control ----------
CONTROL = Schema(
    rules={
        "codigo_infobras": [r"\bcodigo\b.*\binfobras\b", r"\binfobras\b"],
        "cui": [r"\bcui\b", r"codigo unico"],
        "nombre_obra": [r"^obra$", r"nombre de (la )?obra", r"descripcion (de (la )?)?obra"],
        "departamento": [r"^departamento obra$", r"^departamento$", r"departamento"],
        "tipo_control": [r"^tipo control$", r"tipo de control"],
        "tipo_accion": [r"^tipo accion$", r"tipo de accion"],
        "entidad_auditada": [r"^entidad auditada$", r"entidad auditada"],
        "anio_emision": [r"ano emision", r"ano de emision", r"anio emision"],
        "tipo_organo": [r"^tipo organo$", r"tipo de organo"],
        "organo_auditor": [r"organo auditor"],
        "servicio": [r"nombre servicio", r"servicio de control$"],
        "estado": [r"^estado"],
        "nivel_gobierno": [r"nivel (de )?gobierno"],
        "numero_informe": [r"numero (de )?informe", r"n de informe"],
        "titulo_informe": [r"titulo (del )?informe"],
        "url_informe": [r"url spic informe", r"url (del )?informe"],
        "url_resumen": [r"url spic resumen", r"url (del )?resumen"],
    },
    order=[
        "codigo_infobras", "cui", "tipo_control", "tipo_accion", "entidad_auditada", "anio_emision",
        "tipo_organo", "organo_auditor", "servicio", "estado", "nivel_gobierno", "numero_informe",
        "titulo_informe", "url_informe", "url_resumen", "departamento", "nombre_obra",
    ],
    required=["codigo_infobras", "servicio"],
    integer=["anio_emision"],
    upper=["departamento", "entidad_auditada"],
    ids=["codigo_infobras", "cui"],
)

for _s in (OBRAS, CONTROL):
    assert set(_s.order) == set(_s.rules), set(_s.order) ^ set(_s.rules)

# Compatibilidad con el resto del código y los tests.
FIELD_RULES = OBRAS.rules
MATCH_ORDER = OBRAS.order


@dataclass
class ParseResult:
    df: pd.DataFrame
    sheet: str
    header_row: int
    mapping: dict[str, str]          # cabecera original -> campo canónico
    unmapped: list[str]              # cabeceras que no se reconocieron
    sha256: str


def _valid(h) -> bool:
    return isinstance(h, str) and h.strip() != ""


def match_field(header, schema: Schema = OBRAS) -> str | None:
    """Campo al que iría una cabecera suelta (el primero de `order` que la reconoce)."""
    h = norm(header)
    if not h:
        return None
    for f in schema.order:
        if any(re.search(p, h) for p in schema.rules[f]):
            return f
    return None


def map_headers(headers: list, schema: Schema = OBRAS) -> tuple[dict[str, str], list[str]]:
    """Asigna cabeceras a campos. Cada campo recorre sus patrones en orden de
    preferencia y se queda con la primera cabecera libre que coincide."""
    hs = [(str(h), norm(h)) for h in headers if _valid(h)]
    taken: dict[str, str] = {}
    for f in schema.order:
        for pat in schema.rules[f]:
            hit = next((h for h, n in hs if h not in taken and re.search(pat, n)), None)
            if hit:
                taken[hit] = f
                break
    mapping = {h: taken[h] for h, _ in hs if h in taken}   # en el orden del Excel
    unmapped = [h for h, _ in hs if h not in taken]
    return mapping, unmapped


def find_header(raw: pd.DataFrame, schema: Schema = OBRAS, scan_rows: int = 40) -> tuple[int, int]:
    """Devuelve (fila, puntaje) de la fila que más campos canónicos reconoce."""
    best_row, best_score = -1, 0
    for i in range(min(scan_rows, len(raw))):
        values = [v for v in raw.iloc[i].tolist() if isinstance(v, str)]
        score = len(map_headers(values, schema)[0])
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


def to_int(value) -> int | None:
    n = to_number(value)
    return int(n) if n is not None else None


def to_flag(value) -> bool | None:
    s = norm(value)
    if s in {"si", "s", "yes", "true", "1"}:
        return True
    if s in {"no", "n", "false", "0"}:
        return False
    return None


def to_date(series: pd.Series) -> pd.Series:
    def one(v):
        if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
            return pd.NaT
        if isinstance(v, (int, float)) and 20000 < v < 80000:  # serial de Excel
            return pd.Timestamp("1899-12-30") + pd.Timedelta(days=float(v))
        return pd.to_datetime(v, dayfirst=True, errors="coerce")
    return series.map(one)


def _text(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    # La exportación de la Contraloría convierte guiones y comillas en "¿":
    # "Obra X ¿ PNP" o "RECEPCIÓN DE OBRA¿". Un "¿" sin su "?" no es español.
    if "¿" in s and "?" not in s:
        s = re.sub(r"\s*¿\s*$", "", s)
        s = re.sub(r"\s¿\s", " - ", s).replace("¿", "")
    return s if s and s not in {".", "-", "--"} else None


def clean(df: pd.DataFrame, schema: Schema = OBRAS) -> pd.DataFrame:
    out = df.copy()
    special = set(schema.numeric + schema.integer + schema.flags + schema.dates)

    for col in out.columns:
        if col not in special:
            out[col] = out[col].map(_text)
    for col in schema.numeric:
        if col in out:
            out[col] = out[col].map(to_number)
    for col in schema.integer:
        if col in out:
            out[col] = out[col].map(to_int).astype("Int64")
    for col in schema.flags:
        if col in out:
            out[col] = out[col].map(to_flag).astype("boolean")
    for col in schema.dates:
        if col in out:
            out[col] = to_date(out[col]).dt.date
    for col in schema.upper:
        if col in out:
            out[col] = out[col].map(lambda v: v.upper() if isinstance(v, str) else v)
    for col in schema.ids:
        if col in out:
            out[col] = out[col].map(lambda v: str(int(float(v))) if to_number(v) is not None else v)

    if schema is OBRAS:
        if "avance_fisico" in out:
            av = out["avance_fisico"].map(to_number)
            # Algunas bases traen 0.65 y otras 65 para el mismo concepto.
            if av.dropna().size and av.dropna().quantile(0.95) <= 1.0:
                av = av * 100
            out["avance_fisico"] = av.clip(lower=0, upper=100)
        has = set(out.columns)
        if {"costo_actualizado", "monto_ejecutado"} <= has and "saldo_por_ejecutar" not in has:
            out["saldo_por_ejecutar"] = (out["costo_actualizado"] - out["monto_ejecutado"]).clip(lower=0)
        if {"costo_actualizado", "saldo_por_ejecutar"} <= has and "monto_ejecutado" not in has:
            out["monto_ejecutado"] = (out["costo_actualizado"] - out["saldo_por_ejecutar"]).clip(lower=0)
        if "ubigeo" in out:
            out["ubigeo"] = out["ubigeo"].map(lambda v: str(int(float(v))).zfill(6) if to_number(v) is not None else None)
        # Filas de totales o notas al pie: sin nombre de obra o con "total" como departamento.
        out = out[out["nombre_obra"].notna() & (out["nombre_obra"].str.len() > 3)]
        out = out[~out["departamento"].fillna("").str.contains(r"^TOTAL", regex=True)]
    else:
        out = out[out["codigo_infobras"].notna() & out["codigo_infobras"].str.fullmatch(r"\d+")]
    return out.reset_index(drop=True)


def _parse(path: str | Path, schema: Schema) -> ParseResult:
    path = Path(path)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    sheets = pd.read_excel(path, sheet_name=None, header=None, dtype=object)

    best = None
    for name, raw in sheets.items():
        row, score = find_header(raw, schema)
        if row < 0:
            continue
        candidate = (score, len(raw) - row, name, row)
        if best is None or candidate[:2] > best[:2]:
            best = candidate
    if best is None or best[0] < schema.min_score:
        raise ValueError(f"No encontré una cabecera reconocible en {path.name}. Revisa las reglas del parser.")

    _, _, sheet, header_row = best
    raw = sheets[sheet]
    headers = raw.iloc[header_row].tolist()
    mapping, unmapped = map_headers(headers, schema)
    missing = [f for f in schema.required if f not in mapping.values()]
    if missing:
        raise ValueError(f"Faltan columnas obligatorias {missing}. Cabeceras vistas: {headers}")

    body = raw.iloc[header_row + 1:].copy()
    body.columns = [str(h) if _valid(h) else f"_col{i}" for i, h in enumerate(headers)]
    df = body[list(mapping.keys())].rename(columns=mapping)
    df = clean(df, schema)
    # Contrato fijo hacia dbt: siempre las mismas columnas, aunque el informe no traiga alguna.
    for col in schema.rules:
        if col not in df:
            df[col] = None
    df = df[list(schema.rules)]
    return ParseResult(df=df, sheet=str(sheet), header_row=int(header_row), mapping=mapping, unmapped=unmapped, sha256=sha)


def parse_excel(path: str | Path) -> ParseResult:
    """Lista de obras paralizadas."""
    return _parse(path, OBRAS)


def parse_control(path: str | Path) -> ParseResult:
    """Servicios de control efectuados a obras paralizadas."""
    return _parse(path, CONTROL)


def empty_control() -> pd.DataFrame:
    """Tabla vacía con el esquema de control, para cuando no se carga ese anexo."""
    df = pd.DataFrame({c: pd.Series(dtype="object") for c in CONTROL.rules})
    df["anio_emision"] = df["anio_emision"].astype("Int64")
    return df
