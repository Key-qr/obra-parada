-- Ranking de entidades. Ojo: más obras paralizadas no prueba mala gestión de la
-- gestión actual; muchas vienen de gestiones anteriores (ver la web).
select
    entidad,
    any_value(nivel_gobierno)                            as nivel_gobierno,
    any_value(departamento)                              as departamento,
    count(*)                                             as obras,
    sum(costo_actualizado)                               as costo_actualizado,
    sum(saldo_por_ejecutar)                              as saldo_por_ejecutar,
    count(*) filter (where avance_fisico >= 90)          as obras_casi_terminadas
from {{ ref('fct_obras') }}
where entidad is not null
group by entidad
