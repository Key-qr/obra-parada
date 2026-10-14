-- Agregados por zona en los tres niveles del mapa. La web filtra en el cliente,
-- pero estos totales alimentan la portada, el README y los tests de cuadre.
{% set niveles = [
    ('departamento', 'ubigeo_departamento', 'departamento'),
    ('provincia', 'ubigeo_provincia', 'provincia'),
    ('distrito', 'ubigeo_distrito', 'distrito'),
] %}

{% for nivel, col, nombre in niveles %}
select
    '{{ nivel }}'                                       as nivel,
    {{ col }}                                           as ubigeo,
    any_value({{ nombre }})                             as nombre,
    any_value(departamento)                             as departamento,
    count(*)                                            as obras,
    sum(costo_actualizado)                              as costo_actualizado,
    sum(monto_ejecutado)                                as monto_ejecutado,
    sum(saldo_por_ejecutar)                             as saldo_por_ejecutar,
    count(*) filter (where avance_fisico >= 50)         as obras_mitad_o_mas,
    count(*) filter (where avance_fisico >= 90)         as obras_casi_terminadas,
    median(anios_paralizada)                            as mediana_anios_paralizada
from {{ ref('fct_obras') }}
where {{ col }} is not null
group by {{ col }}
{% if not loop.last %}union all{% endif %}
{% endfor %}
