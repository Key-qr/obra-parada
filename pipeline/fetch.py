"""Descubre y descarga la base de obras paralizadas más reciente de la Contraloría.

La Contraloría publica cada trimestre un "Informe de obras (públicas) paralizadas
en el territorio nacional" en gob.pe. La base (Anexo N.° 02) va como archivo
adjunto de la publicación. Este módulo:

1. Busca en el listado de publicaciones de la Contraloría las que calzan con el
   título del informe.
2. Entra a la más reciente y toma el primer adjunto Excel (.xlsx/.xls) o .zip.

Si gob.pe cambia su HTML, se puede saltar el descubrimiento con
`--url` (enlace directo al Excel) o `--file` (archivo ya descargado).
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://www.gob.pe"
SEARCH_URLS = [
    f"{BASE}/institucion/contraloria/informes-publicaciones?term=obras+paralizadas&sheet=1",
    f"{BASE}/institucion/contraloria/informes-publicaciones/tipos/14-reporte",
]
TITLE_RE = re.compile(r"obras\s+(p[uú]blicas\s+)?paralizadas\s+en\s+el\s+territorio\s+nacional", re.I)
MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
    "agosto": 8, "setiembre": 9, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
HEADERS = {"User-Agent": "obra-parada/1.0 (+https://github.com/Key-qr/obra-parada)"}


@dataclass
class Publication:
    title: str
    url: str
    corte: str | None  # "2026-06"


def corte_from_title(title: str) -> str | None:
    m = re.search(r"a\s+(\w+)\s+(?:de(?:l)?\s+)?(\d{4})", title, re.I)
    if not m:
        return None
    month = MONTHS.get(m.group(1).lower())
    return f"{m.group(2)}-{month:02d}" if month else None


def list_publications(session: requests.Session) -> list[Publication]:
    found: dict[str, Publication] = {}
    for url in SEARCH_URLS:
        resp = session.get(url, headers=HEADERS, timeout=60)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for a in soup.select("a[href*='/informes-publicaciones/']"):
            title = " ".join(a.get_text(" ").split())
            if TITLE_RE.search(title):
                href = urljoin(BASE, a["href"])
                found[href] = Publication(title=title, url=href, corte=corte_from_title(title))
    pubs = [p for p in found.values() if p.corte]
    return sorted(pubs, key=lambda p: p.corte, reverse=True)


def attachment_urls(session: requests.Session, pub_url: str) -> list[str]:
    resp = session.get(pub_url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    urls = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if re.search(r"\.(xlsx|xls|zip)(\?|$)", href, re.I) or (
            "cdn.www.gob.pe/uploads/document/file" in href and "pdf" not in href.lower()
        ):
            urls.append(urljoin(BASE, href))
    return urls


def download(session: requests.Session, url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    resp = session.get(url, headers=HEADERS, timeout=180)
    resp.raise_for_status()
    name = Path(url.split("?")[0]).name or "anexo02.xlsx"
    content = resp.content
    if name.lower().endswith(".zip") or content[:2] == b"PK" and not name.lower().endswith((".xlsx", ".xls")):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            excel = [n for n in zf.namelist() if n.lower().endswith((".xlsx", ".xls"))]
            if not excel:
                raise RuntimeError(f"El zip {name} no trae Excel")
            name, content = Path(excel[0]).name, zf.read(excel[0])
    path = dest_dir / name
    path.write_bytes(content)
    return path


def fetch_latest(dest_dir: Path) -> tuple[Path, Publication]:
    with requests.Session() as s:
        pubs = list_publications(s)
        if not pubs:
            raise RuntimeError("No encontré publicaciones de obras paralizadas en gob.pe")
        for pub in pubs:
            urls = attachment_urls(s, pub.url)
            if urls:
                return download(s, urls[0], dest_dir), pub
        raise RuntimeError("Encontré informes pero ninguno trae la base en Excel adjunta")
