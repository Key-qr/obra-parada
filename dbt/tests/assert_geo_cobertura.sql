-- Falla si más del 5% de las obras no se pudo ubicar ni a nivel de departamento:
-- casi siempre significa que el informe trae una variante de nombre nueva.
{{ config(severity='warn') }}
select * from {{ ref('agg_resumen') }}
where geo_sin_match > 0.05 * obras
