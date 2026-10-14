-- Cifras de portada: una sola fila.
select
    count(*)                                                        as obras,
    sum(costo_actualizado)                                          as costo_actualizado,
    sum(monto_ejecutado)                                            as monto_ejecutado,
    sum(saldo_por_ejecutar)                                         as saldo_por_ejecutar,
    count(*) filter (where avance_fisico >= 50)                     as obras_mitad_o_mas,
    count(*) filter (where avance_fisico >= 90)                     as obras_casi_terminadas,
    sum(saldo_por_ejecutar) filter (where avance_fisico >= 90)      as saldo_casi_terminadas,
    count(distinct entidad)                                         as entidades,
    count(*) filter (where geo_metodo in ('ubigeo_fuente','dep_prov_dist','dep_dist','dist_aproximado')) as geo_distrito,
    count(*) filter (where geo_metodo = 'provincia')                as geo_provincia,
    count(*) filter (where geo_metodo = 'departamento')             as geo_departamento,
    count(*) filter (where geo_metodo = 'sin_match')                as geo_sin_match,
    median(anios_paralizada)                                        as mediana_anios_paralizada,
    median(anio_inicio)                                             as mediana_anio_inicio,
    count(*) filter (where tiene_pim)                               as obras_con_pim,
    sum(pim_anual)                                                  as pim_total,
    count(*) filter (where en_lista_priorizada)                     as obras_priorizadas,
    count(*) filter (where n_controles > 0)                         as obras_con_control,
    (select count(*) from {{ ref('fct_control') }})                 as servicios_control
from {{ ref('fct_obras') }}
