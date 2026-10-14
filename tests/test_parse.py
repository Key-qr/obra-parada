import pandas as pd
import pytest
from openpyxl import Workbook

from pipeline.parse import map_headers, match_field, parse_excel, to_number
from pipeline.text import norm


@pytest.mark.parametrize("raw,expected", [
    ("1,234,567.89", 1234567.89),
    ("1.234.567,89", 1234567.89),
    ("S/ 2,500.00", 2500.0),
    ("12,5", 12.5),
    ("65.3%", 65.3),
    ("-", None),
    (None, None),
    (1500, 1500.0),
])
def test_to_number(raw, expected):
    assert to_number(raw) == expected


@pytest.mark.parametrize("header,field", [
    ("CÓDIGO INFOBRAS", "codigo_infobras"),
    ("Código Único de Inversión", "cui"),
    ("NOMBRE DE LA OBRA", "nombre_obra"),
    ("Monto de inversión ejecutado (S/)", "monto_ejecutado"),
    ("Saldo de inversión", "saldo_por_ejecutar"),
    ("COSTO ACTUALIZADO DE LA OBRA", "costo_actualizado"),
    ("% Avance físico", "avance_fisico"),
    ("Avance financiero", None),
    ("Causal u origen de la paralización", "causal_paralizacion"),
    ("Fecha de paralización", "fecha_paralizacion"),
    ("Nivel de Gobierno", "nivel_gobierno"),
    ("Entidad pública", "entidad"),
])
def test_match_field(header, field):
    assert match_field(header) == field


def test_each_field_used_once():
    mapping, unmapped = map_headers(["Departamento", "Región", "Obra"])
    assert list(mapping.values()) == ["departamento", "nombre_obra"]
    assert unmapped == ["Región"]


def test_norm_aliases():
    assert norm("Provincia Constitucional del Callao") == "callao"
    assert norm("  Áncash ") == "ancash"
    assert norm("Lima Metropolitana") == "lima"


def _write(tmp_path, rows):
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    path = tmp_path / "anexo.xlsx"
    wb.save(path)
    return path


def test_parse_finds_header_below_titles_and_drops_totals(tmp_path):
    path = _write(tmp_path, [
        ["INFORME DE OBRAS PARALIZADAS"],
        [],
        ["Departamento", "Provincia", "Distrito", "Entidad", "Nombre de la obra",
         "Costo actualizado", "Monto ejecutado", "Avance físico", "Fecha de paralización"],
        ["Cusco", "Cusco", "Santiago", "Ent A", "Obra número uno", "1,000,000.00", "400,000", 0.4, 45000],
        ["Puno", "Puno", "Puno", "Ent B", "Obra número dos", 500000, 500000, 1.0, "15/03/2024"],
        ["TOTAL", None, None, None, None, 1500000],
    ])
    res = parse_excel(path)
    df = res.df
    assert res.header_row == 2
    assert len(df) == 2
    # avance en escala 0-1 se lleva a 0-100
    assert df["avance_fisico"].tolist() == [40.0, 100.0]
    # el saldo se calcula si no viene
    assert df["saldo_por_ejecutar"].tolist() == [600000.0, 0.0]
    assert df["departamento"].tolist() == ["CUSCO", "PUNO"]
    assert str(df["fecha_paralizacion"][1]) == "2024-03-15"
    assert pd.notna(df["fecha_paralizacion"][0])  # serial de Excel


def test_parse_fails_loud_without_header(tmp_path):
    path = _write(tmp_path, [["a", "b"], [1, 2]])
    with pytest.raises(ValueError):
        parse_excel(path)


# ---------- formato real del informe de junio de 2026 ----------
from pipeline.parse import CONTROL, OBRAS, parse_control  # noqa: E402

CABECERA_2026 = [
    "N°", "CODIGO INFOBRAS", "CUI", "DESCRIPCION DE INVERSION", "DESCRIPCION OBRA", "ENTIDAD",
    "COSTO DE OBRA SEGÚN EXP. TEC.\n(Según INFOBRAS S/)", "SALDO DE OBRA\n(Costo de obra - Avance Valorizado)",
    "COSTO ACTUALIZADO\n(Según INVIERTE S/)", "SALDO DE LA INVERSIÓN\n(Según INVIERTE S/)", "PIM 2026",
    "TIENE PIM 2026", "TIPO DE OBRA (Nivel 2)", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "AÑO INICIO OBRA",
    "AVANCE FÍSICO", "RANGO AVANCE FÍSICO", "CAUSAL PARALIZACION", "DENTRO DE LA LISTA PRIORIZADA", "URL INFORME",
]


def test_columnas_2026_toman_costo_y_saldo_de_invierte():
    """Hay dos costos y dos saldos; manda el de Invierte.pe (actualizado), no el del expediente."""
    mapping, unmapped = map_headers(CABECERA_2026, OBRAS)
    inv = {v: k for k, v in mapping.items()}
    assert inv["costo_actualizado"].startswith("COSTO ACTUALIZADO")
    assert inv["saldo_por_ejecutar"].startswith("SALDO DE LA INVERSIÓN")
    assert inv["nombre_obra"] == "DESCRIPCION OBRA"
    assert inv["anio_inicio"] == "AÑO INICIO OBRA"
    assert inv["pim_anual"] == "PIM 2026" and inv["tiene_pim"] == "TIENE PIM 2026"
    assert inv["avance_fisico"] == "AVANCE FÍSICO"
    assert "RANGO AVANCE FÍSICO" in unmapped and "DESCRIPCION DE INVERSION" in unmapped


def test_parse_2026(tmp_path):
    fila = [1, 59, 2100376, "INVERSION X", "OBRA X", "ENTIDAD X", 1000, 0, 1200.5, 300, 0, "NO",
            "Riego", "PUNO", "LAMPA", "CABANILLA", 2010, 78, "70 - 80 %", "15 OTROS", "SI", None]
    path = _write(tmp_path, [CABECERA_2026, fila])
    df = parse_excel(path).df
    o = df.iloc[0]
    assert o["costo_actualizado"] == 1200.5 and o["saldo_por_ejecutar"] == 300
    assert o["monto_ejecutado"] == pytest.approx(900.5)
    assert o["anio_inicio"] == 2010 and o["avance_fisico"] == 78
    assert bool(o["tiene_pim"]) is False and bool(o["en_lista_priorizada"]) is True


def test_parse_control(tmp_path):
    path = _write(tmp_path, [
        ["N°", "CODIGO INFOBRAS", "CUI", "OBRA", "DEPARTAMENTO OBRA", "TIPO_CONTROL", "TIPO_ACCION",
         "ENTIDAD AUDITADA", "AÑO EMISION", "ORGANO AUDITOR", "NOMBRE SERVICIO CONTROL", "NUMERO INFORME", "TITULO INFORME",
         "URL SPIC INFORME", "URL SPIC RESUMEN"],
        [1, 27574, 2226480, "OBRA X", "AMAZONAS", "Control Simultáneo", "ORIENTACIÓN DE OFICIO", "GORE",
         2017, "GERENCIA", "Orientación de Oficio", "00005-2017-CG/C", "VISITA ¿ INFORME¿", "http://x/a.pdf", "http://x/b.pdf"],
    ])
    res = parse_control(path)
    c = res.df.iloc[0]
    assert str(c["codigo_infobras"]) == "27574"
    assert c["tipo_accion"] == "ORIENTACIÓN DE OFICIO"
    assert int(c["anio_emision"]) == 2017
    # caracteres rotos de la fuente: "¿" sin "?" que lo cierre
    assert c["titulo_informe"] == "VISITA - INFORME"
    assert set(CONTROL.order) >= {"url_informe", "url_resumen", "numero_informe"}
