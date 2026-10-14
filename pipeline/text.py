"""Normalización de texto para cruzar nombres de lugares y cabeceras de Excel."""
import re
import unicodedata

# Variantes que aparecen en las bases del Estado y no coinciden con el INEI.
ALIASES = {
    "callao": "callao",
    "provincia constitucional del callao": "callao",
    "lima metropolitana": "lima",
    "lima provincias": "lima",
    "region lima": "lima",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(value) -> str:
    """'Áncash ' -> 'ancash', 'Sto. Domingo' -> 'sto domingo'."""
    if value is None:
        return ""
    s = strip_accents(str(value)).lower()
    s = s.replace("ñ", "n")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return ALIASES.get(s, s)
