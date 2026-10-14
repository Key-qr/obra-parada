-- Una fila por obra tal como sale del parser (data/staging/obras.parquet),
-- con tipos fijos, textos de catálogo en tipo oración y llaves normalizadas
-- para cruzar con el ubigeo.
with src as (
    select * from read_parquet('{{ var("staging_parquet") }}')
)

select
    row_number() over ()                                   as obra_sk,
    nullif(trim(cast(codigo_infobras as varchar)), '')     as codigo_infobras,
    nullif(trim(cast(cui as varchar)), '')                 as cui,
    nombre_obra,
    departamento,
    provincia,
    distrito,
    nullif(lpad(cast(ubigeo as varchar), 6, '0'), '000000') as ubigeo_fuente,
    {{ norm('departamento') }}                             as departamento_key,
    {{ norm('provincia') }}                                as provincia_key,
    {{ norm('distrito') }}                                 as distrito_key,
    entidad,
    case
        when {{ norm('nivel_gobierno') }} like '%local%'    then 'Local'
        when {{ norm('nivel_gobierno') }} like '%regional%' then 'Regional'
        when {{ norm('nivel_gobierno') }} like '%nacional%' then 'Nacional'
        else coalesce(nivel_gobierno, 'Sin dato')
    end                                                    as nivel_gobierno,
    coalesce({{ sentence('sector') }}, 'Sin dato')         as sector,
    case
        when {{ norm('modalidad_ejecucion') }} = 'contrata' then 'Por contrata'
        else coalesce({{ sentence('modalidad_ejecucion') }}, 'Sin dato')
    end                                                    as modalidad_ejecucion,
    coalesce({{ sentence('causal_paralizacion') }}, 'Sin dato') as causal_paralizacion,
    {{ sentence('evento_asociado') }}                      as evento,
    {{ sentence('tipo_obra_1') }}                          as tipo_obra_1,
    {{ sentence('tipo_obra_2') }}                          as tipo_obra_2,
    {{ sentence('tipo_obra_3') }}                          as tipo_obra_3,
    cast(costo_actualizado as double)                      as costo_actualizado,
    cast(monto_ejecutado as double)                        as monto_ejecutado,
    cast(saldo_por_ejecutar as double)                     as saldo_por_ejecutar,
    cast(avance_fisico as double)                          as avance_fisico,
    try_cast(fecha_paralizacion as date)                   as fecha_paralizacion,
    try_cast(anio_inicio as integer)                       as anio_inicio,
    try_cast(plazo_dias as integer)                        as plazo_dias,
    try_cast(pim_anual as double)                          as pim_anual,
    try_cast(tiene_pim as boolean)                         as tiene_pim,
    try_cast(en_inventario_mef as boolean)                 as en_inventario_mef,
    try_cast(en_lista_priorizada as boolean)               as en_lista_priorizada,
    case when url_informe_situacional like 'http%' then url_informe_situacional end   as url_informe_situacional,
    case when url_resolucion_priorizada like 'http%' then url_resolucion_priorizada end as url_resolucion_priorizada
from src
