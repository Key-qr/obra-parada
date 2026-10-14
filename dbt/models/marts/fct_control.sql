-- Servicios de control con la ubicación y el nombre de la obra a la que se refieren.
select
    c.control_sk,
    c.codigo_infobras,
    o.obra_sk,
    o.nombre_obra,
    o.ubigeo_departamento,
    o.departamento,
    c.tipo_control,
    c.tipo_accion,
    c.entidad_auditada,
    c.anio_emision,
    c.tipo_organo,
    c.organo_auditor,
    c.servicio,
    c.estado,
    c.numero_informe,
    c.titulo_informe,
    c.url_informe,
    c.url_resumen
from {{ ref('stg_control') }} c
left join {{ ref('fct_obras') }} o on o.codigo_infobras = c.codigo_infobras
