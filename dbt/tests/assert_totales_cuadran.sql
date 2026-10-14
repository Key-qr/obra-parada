-- La suma por departamento debe cuadrar con el total de la tabla de hechos
-- (sin contar las obras que no se pudieron ubicar).
with por_dep as (
    select sum(obras) as obras from {{ ref('agg_zona') }} where nivel = 'departamento'
),
total as (
    select count(*) as obras from {{ ref('fct_obras') }} where ubigeo_departamento is not null
)
select * from por_dep, total where por_dep.obras <> total.obras
