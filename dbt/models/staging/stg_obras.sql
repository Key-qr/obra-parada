-- Una fila por obra tal como sale del parser (data/staging/obras.parquet),
-- con tipos fijos y llaves de texto normalizadas para cruzar con el ubigeo.
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
    coalesce(sector, 'Sin dato')                           as sector,
    coalesce(modalidad_ejecucion, 'Sin dato')              as modalidad_ejecucion,
    coalesce(causal_paralizacion, 'Sin dato')              as causal_paralizacion,
    cast(costo_actualizado as double)                      as costo_actualizado,
    cast(monto_ejecutado as double)                        as monto_ejecutado,
    cast(saldo_por_ejecutar as double)                     as saldo_por_ejecutar,
    cast(avance_fisico as double)                          as avance_fisico,
    try_cast(fecha_paralizacion as date)                   as fecha_paralizacion
from src
