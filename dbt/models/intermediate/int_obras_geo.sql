-- Geolocaliza cada obra al nivel más fino posible.
-- Orden de intento: ubigeo de la fuente > dep+prov+dist > dep+dist > nombre parecido
-- dentro de la misma provincia (Raimondi/Raymondi, "Pueblo Libre (Magdalena Vieja)")
-- > provincia > departamento.
-- Los distritos creados después del límite INEI 2007 no están en el mapa y caen a su provincia.
with obras as (select * from {{ ref('stg_obras') }}),
dim as (select * from {{ ref('dim_ubigeo') }}),

provincias as (
    select distinct ubigeo_prov, ubigeo_dep, provincia, departamento, provincia_key, departamento_key from dim
),
departamentos as (
    select distinct ubigeo_dep, departamento, departamento_key from dim
),

-- En dep+dist puede haber homónimos: solo vale si el match es único.
dist_por_dep as (
    select departamento_key, distrito_key, any_value(ubigeo) as ubigeo
    from dim group by 1, 2 having count(*) = 1
),

-- Coincidencia aproximada del distrito dentro de su provincia: el más parecido
-- por Jaro-Winkler, o el que es prefijo del nombre de la fuente.
aprox as (
    select
        o.obra_sk,
        arg_max(d.ubigeo, case when starts_with(o.distrito_key, d.distrito_key || ' ') then 1.0
                               else jaro_winkler_similarity(o.distrito_key, d.distrito_key) end) as ubigeo,
        max(case when starts_with(o.distrito_key, d.distrito_key || ' ') then 1.0
                 else jaro_winkler_similarity(o.distrito_key, d.distrito_key) end)                as score
    from obras o
    join dim d
      on d.departamento_key = o.departamento_key
     and d.provincia_key = o.provincia_key
    where o.distrito_key <> ''
    group by o.obra_sk
),

matched as (
    select
        o.*,
        coalesce(d_src.ubigeo, d_full.ubigeo, d_dep.ubigeo, ap.ubigeo) as ubigeo_distrito,
        case
            when d_src.ubigeo  is not null then 'ubigeo_fuente'
            when d_full.ubigeo is not null then 'dep_prov_dist'
            when d_dep.ubigeo  is not null then 'dep_dist'
            when ap.ubigeo     is not null then 'dist_aproximado'
            when p.ubigeo_prov is not null then 'provincia'
            when dp.ubigeo_dep is not null then 'departamento'
            else 'sin_match'
        end                                                          as geo_metodo,
        p.ubigeo_prov                                                as ubigeo_prov_match,
        dp.ubigeo_dep                                                as ubigeo_dep_match
    from obras o
    left join dim d_src
        on d_src.ubigeo = o.ubigeo_fuente
    left join dim d_full
        on d_full.departamento_key = o.departamento_key
       and d_full.provincia_key = o.provincia_key
       and d_full.distrito_key = o.distrito_key
    left join dist_por_dep d_dep
        on d_dep.departamento_key = o.departamento_key
       and d_dep.distrito_key = o.distrito_key
    left join aprox ap
        on ap.obra_sk = o.obra_sk
       and ap.score >= 0.9
    left join provincias p
        on p.departamento_key = o.departamento_key
       and p.provincia_key = o.provincia_key
    left join departamentos dp
        on dp.departamento_key = o.departamento_key
)

select
    m.* exclude (ubigeo_prov_match, ubigeo_dep_match),
    coalesce(dim.ubigeo_prov, m.ubigeo_prov_match)                   as ubigeo_provincia,
    coalesce(dim.ubigeo_dep, m.ubigeo_dep_match)                     as ubigeo_departamento,
    -- Nombres "oficiales" del INEI para mostrar, con la fuente como respaldo.
    coalesce(dim.departamento, initcap(m.departamento))              as departamento_nombre,
    coalesce(dim.provincia, initcap(m.provincia))                    as provincia_nombre,
    coalesce(dim.distrito, initcap(m.distrito))                      as distrito_nombre
from matched m
left join dim on dim.ubigeo = m.ubigeo_distrito
