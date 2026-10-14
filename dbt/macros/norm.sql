{#- Misma normalización que pipeline/text.py: sin tildes, minúsculas, solo [a-z0-9 ]. -#}
{% macro norm(col) -%}
case
    when {{ col }} is null then ''
    else (
        with_alias(trim(regexp_replace(lower(strip_accents({{ col }})), '[^a-z0-9]+', ' ', 'g')))
    )
end
{%- endmacro %}

{#- DuckDB no deja definir funciones en un CTE, así que el alias va como macro SQL. -#}
{% macro create_norm_macros() %}
create or replace macro with_alias(s) as
    case s
        when 'provincia constitucional del callao' then 'callao'
        when 'lima metropolitana' then 'lima'
        when 'lima provincias' then 'lima'
        when 'region lima' then 'lima'
        when 'p c del callao' then 'callao'
        when 'prov const del callao' then 'callao'
        when 'provincia constitucional callao' then 'callao'
        else s
    end;

create or replace macro initcap(s) as
    array_to_string(list_transform(string_split(lower(s), ' '), lambda x: upper(x[1]) || x[2:]), ' ');
{% endmacro %}

{#- "2 INCUMPLIMIENTO DE CONTRATO " -> "Incumplimiento de contrato". Quita el número de
    catálogo que la Contraloría antepone y deja la frase en tipo oración. -#}
{% macro sentence(col) -%}
case
    when nullif(trim({{ col }}), '') is null then null
    else (
        upper(left(trim(regexp_replace(trim({{ col }}), '^[0-9]+\s*', '')), 1))
        || lower(substr(trim(regexp_replace(trim({{ col }}), '^[0-9]+\s*', '')), 2))
    )
end
{%- endmacro %}

{#- El catálogo de tipos de acción viene sin tildes ("Auditoria de cumplimiento").
    Se corrigen las palabras que aparecen en él; el resto queda igual. -#}
{% macro tildes(expr) -%}
{%- set fixes = [
    ("Accion", "Acción"), ("accion", "acción"), ("Auditoria", "Auditoría"), ("auditoria", "auditoría"),
    ("Evaluacion", "Evaluación"), ("evaluacion", "evaluación"), ("Opinion", "Opinión"),
    ("especifico", "específico"), ("publicas", "públicas"), ("simultanea", "simultánea"),
    ("supervision", "supervisión")
] -%}
{%- set ns = namespace(sql=expr) -%}
{%- for a, b in fixes -%}
{%- set ns.sql = "regexp_replace(" ~ ns.sql ~ ", '\\b" ~ a ~ "\\b', '" ~ b ~ "', 'g')" -%}
{%- endfor -%}
{{ ns.sql }}
{%- endmacro %}
