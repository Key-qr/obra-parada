# Diccionario de datos

## Fuente

Contraloría General de la República, *Informe de obras (públicas) paralizadas en el territorio nacional*, publicado cada trimestre en gob.pe. La base de obras va como archivo Excel aparte del PDF. En el informe a junio de 2026 es el **Anexo N.° 01: Base de datos con la lista de obras públicas paralizadas** (en informes anteriores el número de anexo cambió). El Anexo N.° 02 de ese informe es otra base: los servicios de control efectuados a las obras.

La Contraloría considera paralizada una obra que no registra avance físico por seis meses o más en Infobras.

Los nombres de columna del Excel cambian entre informes. El parser los mapea a estos campos canónicos (reglas en `pipeline/parse.py`, esquemas `OBRAS` y `CONTROL`). El mapeo exacto usado en cada carga queda en `web/data/meta.json`, campos `columnas` y `control.columnas`.

## `fct_obras` (y `web/data/obras.json`)

Una fila por obra del Anexo N.° 01.

| Campo dbt | Clave JSON | Tipo | Descripción |
|---|---|---|---|
| codigo_infobras | id | texto | Código de la obra en Infobras |
| cui | cui | texto | Código Único de Inversión (Invierte.pe) |
| nombre_obra | nombre | texto | Descripción de la obra tal como la registra la entidad |
| entidad | entidad | texto | Entidad ejecutora |
| nivel_gobierno | nivel | texto | Local, Regional o Nacional |
| sector | sector | texto | Sector de la inversión |
| modalidad_ejecucion | modalidad | texto | Por contrata, administración directa, núcleo ejecutor, etc. |
| causal_paralizacion | causal | texto | Causa declarada por la entidad, sin el número de catálogo |
| evento | evento | texto | Proceso normal, Reconstrucción con Cambios, etc. |
| tipo_obra_1, tipo_obra_2, tipo_obra_3 | tipo1, tipo2, tipo3 | texto | Tipo de obra de la Contraloría en tres niveles; la web usa el nivel 2 |
| ubigeo_departamento | u_dep | texto(2) | Ubigeo INEI del departamento |
| ubigeo_provincia | u_prov | texto(4) | Ubigeo INEI de la provincia |
| ubigeo_distrito | u_dist | texto(6) | Ubigeo INEI del distrito; nulo si solo se ubicó a nivel superior |
| departamento, provincia, distrito | dep, prov, dist | texto | Nombres para mostrar |
| geo_metodo | geo | texto | Cómo se ubicó: `ubigeo_fuente`, `dep_prov_dist`, `dep_dist`, `dist_aproximado`, `provincia`, `departamento`, `sin_match` |
| costo_actualizado | costo | número (S/) | Costo actualizado según Invierte.pe |
| monto_ejecutado | ejecutado | número (S/) | `costo_actualizado - saldo_por_ejecutar` cuando el informe no lo trae |
| saldo_por_ejecutar | saldo | número (S/) | Saldo de la inversión según Invierte.pe: lo que falta ejecutar |
| avance_fisico | avance | número (%) | Avance físico, 0 a 100 |
| anio_inicio | ini | entero | Año en que empezó la obra |
| antiguedad_anios | antig | entero | Años desde el inicio hasta el año de corte del informe |
| plazo_dias | plazo | entero | Plazo de ejecución previsto, en días |
| pim_anual | pim | número (S/) | Presupuesto Institucional Modificado del año del informe |
| tiene_pim | con_pim | booleano | Si tiene presupuesto asignado ese año |
| en_inventario_mef | inv_mef | booleano | Si está en el inventario de obras paralizadas del MEF |
| en_lista_priorizada | prior | booleano | Si está en la lista priorizada para reactivarse |
| url_informe_situacional | url_sit | URL | Informe de estado situacional en Invierte.pe |
| url_resolucion_priorizada | url_res | URL | Resolución de la lista priorizada |
| n_controles | nctrl | entero | Servicios de control registrados en el Anexo N.° 02 |
| fecha_paralizacion, anios_paralizada | f_paral, anios | fecha, número | Se mantienen por compatibilidad con informes anteriores; el de junio de 2026 no trae fecha de paralización |

## `fct_control` (y `web/data/control.json`)

Una fila por servicio de control del Anexo N.° 02. Todos los de junio de 2026 están en estado "Concluida".

| Campo dbt | Clave JSON | Tipo | Descripción |
|---|---|---|---|
| codigo_infobras | id | texto | Obra a la que se refiere (llave hacia `fct_obras`) |
| tipo_control | tipo | texto | Control previo, simultáneo o posterior |
| tipo_accion | accion | texto | Control concurrente, orientación de oficio, visita, auditoría de cumplimiento… |
| entidad_auditada | entidad | texto | Entidad revisada |
| anio_emision | anio | entero | Año de emisión del informe |
| tipo_organo | organo_tipo | texto | Órgano de control institucional (OCI) o Contraloría general |
| organo_auditor | organo | texto | Unidad que hizo el control |
| servicio | servicio | texto | Nombre del servicio de control |
| numero_informe | num | texto | Número del informe |
| titulo_informe | titulo | texto | Título del informe |
| url_informe | url | URL | PDF del informe en el SPIC. Si sigue el patrón `…/SPIC/srvDownload/ViewPDF?CRES_CODIGO=X&TIPOARCHIVO=ADJUNTO`, el JSON guarda solo `spic:X` |
| url_resumen | url_res | URL | PDF del resumen (`TIPOARCHIVO=RE`). Nulo en el JSON cuando se deriva del mismo código |

Algunas filas traen el servidor interno del SPIC (`http://localhost:puerto/...`) en vez del público; `stg_control` lo corrige.

## `web/data/meta.json`

Procedencia de la carga: fecha de corte, publicación, URL, nombre del archivo, SHA-256, hoja y fila de cabecera usadas, mapeo de columnas, columnas no reconocidas, número de filas y si son datos de muestra.

## `web/data/obras_por_depto.json`

Lo arma `scripts/build_puntos.mjs` después del export (`make export` lo corre). Una fila corta por obra, agrupadas por ubigeo de departamento y ordenadas de mayor a menor saldo; lo usan las vistas de puntos de Inicio y Comparar.

| Posición | Campo | Nota |
|---|---|---|
| 0, 1 | x, y | Centro del distrito (o de la provincia o el departamento si no hay distrito) en el plano de 420 px de ancho de los mapas de puntos, con un ruido fijo para separar obras del mismo lugar |
| 2 | avance | Entero 0-100; -1 sin dato |
| 3 | causa | 0 incumplimiento de contrato, 1 falta de recursos, 2 arbitraje, 3 expediente técnico, 4 abandono, 5 otra |
| 4 | inicio | Año de inicio menos 2000; 0 sin dato |
| 5 | saldo | Falta ejecutar en millones con 4 decimales (S/ 100); 0 sin saldo registrado |
| 6 | nombre | Recortado a 70 caracteres |
| 7 | distrito | |
| 8 | nivel | L local, R regional, N nacional |

## Geodatos

`web/data/geo/{departamentos,provincias,distritos}.json` en TopoJSON, simplificados con mapshaper. Origen: límites del INEI (2007) publicados en [juaneladio/peru-geojson](https://github.com/juaneladio/peru-geojson). Propiedades: `ubigeo`, `nombre` y los nombres de los niveles superiores.

Distritos sin geometría en la fuente: Amantaní, El Parco, La Punta, Santa Anita, Goyllarisquizga, Acopampa, Trita y Bellavista (Sullana).
