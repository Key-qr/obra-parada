-- Tabla de hechos: una fila por obra paralizada, lista para la web.
with o as (select * from {{ ref('int_obras_geo') }}),
dep as (select * from {{ ref('dim_departamento') }})

select
    o.obra_sk,
    o.codigo_infobras,
    o.cui,
    o.nombre_obra,
    o.entidad,
    o.nivel_gobierno,
    o.sector,
    o.modalidad_ejecucion,
    o.causal_paralizacion,
    o.ubigeo_departamento,
    o.ubigeo_provincia,
    o.ubigeo_distrito,
    coalesce(dep.departamento_display, o.departamento_nombre)       as departamento,
    o.provincia_nombre                                              as provincia,
    o.distrito_nombre                                               as distrito,
    o.geo_metodo,
    round(o.costo_actualizado, 2)                                   as costo_actualizado,
    round(o.monto_ejecutado, 2)                                     as monto_ejecutado,
    round(coalesce(o.saldo_por_ejecutar,
                   greatest(o.costo_actualizado - o.monto_ejecutado, 0)), 2) as saldo_por_ejecutar,
    round(o.avance_fisico, 1)                                       as avance_fisico,
    o.fecha_paralizacion,
    -- Años sin avance a la fecha de corte del informe, no a hoy.
    case when o.fecha_paralizacion is not null then
        round(date_diff('day', o.fecha_paralizacion, cast('{{ var("fecha_corte") }}' as date)) / 365.25, 1)
    end                                                             as anios_paralizada,
    case
        when o.avance_fisico >= 90 then '90-100%'
        when o.avance_fisico >= 50 then '50-89%'
        when o.avance_fisico >= 0  then '0-49%'
        else 'Sin dato'
    end                                                             as tramo_avance
from o
left join dep on dep.ubigeo_dep = o.ubigeo_departamento
