# Diccionario de datos

## Fuente

Contraloría General de la República, *Informe de obras (públicas) paralizadas en el territorio nacional*, publicado cada trimestre en gob.pe. La base de obras va como archivo Excel aparte del PDF. En el informe a junio de 2026 es el **Anexo N.° 01: Base de datos con la lista de obras públicas paralizadas** (en informes anteriores el número de anexo cambió). El Anexo N.° 02 de ese informe es otra base: los servicios de control efectuados a las obras.

La Contraloría considera paralizada una obra que no registra avance físico por seis meses o más en Infobras.

Los nombres de columna del Excel cambian entre informes. El parser los mapea a estos campos canónicos (reglas en `pipeline/parse.py`, `FIELD_RULES`). El mapeo exacto usado en cada carga queda en `web/data/meta.json`, campo `columnas`.

## `fct_obras` (y `web/data/obras.json`)

| Campo dbt | Clave JSON | Tipo | Descripción |
|---|---|---|---|
| codigo_infobras | id | texto | Código de la obra en Infobras |
| cui | cui | texto | Código Único de Inversión (Invierte.pe) |
| nombre_obra | nombre | texto | Nombre de la obra tal como lo registra la entidad |
| entidad | entidad | texto | Entidad ejecutora |
| nivel_gobierno | nivel | texto | Local, Regional o Nacional |
| sector | sector | texto | Sector de la inversión |
| modalidad_ejecucion | modalidad | texto | Por contrata, administración directa, núcleo ejecutor, etc. |
| causal_paralizacion | causal | texto | Causa declarada por la entidad |
| ubigeo_departamento | u_dep | texto(2) | Ubigeo INEI del departamento |
| ubigeo_provincia | u_prov | texto(4) | Ubigeo INEI de la provincia |
| ubigeo_distrito | u_dist | texto(6) | Ubigeo INEI del distrito; nulo si solo se ubicó a nivel superior |
| departamento, provincia, distrito | dep, prov, dist | texto | Nombres para mostrar |
| geo_metodo | geo | texto | Cómo se ubicó: `ubigeo_fuente`, `dep_prov_dist`, `dep_dist`, `provincia`, `departamento`, `sin_match` |
| costo_actualizado | costo | número (S/) | Costo actualizado de la obra |
| monto_ejecutado | ejecutado | número (S/) | Monto ejecutado acumulado |
| saldo_por_ejecutar | saldo | número (S/) | Lo que falta ejecutar. Si el informe no lo trae, `costo - ejecutado` |
| avance_fisico | avance | número (%) | Avance físico, 0 a 100 |
| fecha_paralizacion | f_paral | fecha | Desde cuándo está paralizada |
| anios_paralizada | anios | número | Años sin avance a la **fecha de corte del informe** (no a hoy) |

## `web/data/meta.json`

Procedencia de la carga: fecha de corte, publicación, URL, nombre del archivo, SHA-256, hoja y fila de cabecera usadas, mapeo de columnas, columnas no reconocidas, número de filas y si son datos de muestra.

## Geodatos

`web/data/geo/{departamentos,provincias,distritos}.json` en TopoJSON, simplificados con mapshaper. Origen: límites del INEI (2007) publicados en [juaneladio/peru-geojson](https://github.com/juaneladio/peru-geojson). Propiedades: `ubigeo`, `nombre` y los nombres de los niveles superiores.

Distritos sin geometría en la fuente: Amantaní, El Parco, La Punta, Santa Anita, Goyllarisquizga, Acopampa, Trita y Bellavista (Sullana).
