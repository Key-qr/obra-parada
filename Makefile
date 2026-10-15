# Pipeline completo: make all
# Con los Excel descargados a mano:
#   make all FILE=data/raw/anexo01.xlsx CONTROL=data/raw/anexo02.xlsx CORTE=2026-06
# Con datos sintéticos para desarrollar: make sample

PY ?= python3
CORTE ?=
FILE ?=
CONTROL ?=
DBT = cd dbt && dbt
# Último día del mes de corte, para calcular "años paralizada" contra la fecha del informe.
FECHA_CORTE = $(shell $(PY) -c "import json,calendar;c=json.load(open('data/staging/meta.json'))['corte'] or '';y,m=map(int,c.split('-')) if c else (0,0);print(f'{y}-{m:02d}-{calendar.monthrange(y,m)[1]}' if c else '')")

.PHONY: all sample geo ingest transform export test serve clean

all: ingest transform export

geo:
	./scripts/build_geo.sh

ingest:
ifdef FILE
	$(PY) -m pipeline.cli ingest --file $(FILE) $(if $(CONTROL),--control-file $(CONTROL)) $(if $(CORTE),--corte $(CORTE))
else
	$(PY) -m pipeline.cli ingest $(if $(CORTE),--corte $(CORTE))
endif

transform:
	$(DBT) build --profiles-dir . --vars '{fecha_corte: "$(FECHA_CORTE)"}'

export:
	$(PY) -m pipeline.cli export
	node scripts/build_puntos.mjs

sample:
	$(PY) scripts/make_fixture.py data/raw/fixture_anexo01.xlsx --control data/raw/fixture_anexo02.xlsx --rows 900
	$(PY) -m pipeline.cli ingest --file data/raw/fixture_anexo01.xlsx --control-file data/raw/fixture_anexo02.xlsx --corte 2026-06 --sample
	$(MAKE) transform export

test:
	$(PY) -m pytest -q tests

serve:
	$(PY) -m http.server 8000 -d web

clean:
	rm -rf data/staging data/warehouse.duckdb dbt/target dbt/logs
