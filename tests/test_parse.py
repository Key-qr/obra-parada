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
