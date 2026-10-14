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
        else s
    end;

create or replace macro initcap(s) as
    array_to_string(list_transform(string_split(lower(s), ' '), lambda x: upper(x[1]) || x[2:]), ' ');
{% endmacro %}
