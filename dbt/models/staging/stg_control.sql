-- Servicios de control efectuados a obras paralizadas (una fila por servicio).
-- Puede venir vacío si no se cargó esa base.
select
    row_number() over ()                                   as control_sk,
    nullif(trim(cast(codigo_infobras as varchar)), '')     as codigo_infobras,
    nullif(trim(cast(cui as varchar)), '')                 as cui,
    coalesce({{ sentence('tipo_control') }}, 'Sin dato')   as tipo_control,
    coalesce({{ tildes(sentence('tipo_accion')) }}, 'Sin dato') as tipo_accion,
    entidad_auditada,
    try_cast(anio_emision as integer)                      as anio_emision,
    {{ sentence('tipo_organo') }}                          as tipo_organo,
    organo_auditor,
    servicio,
    estado,
    {{ sentence('nivel_gobierno') }}                       as nivel_gobierno,
    numero_informe,
    titulo_informe,
    -- Algunas filas traen el servidor interno del SPIC (http://localhost:puerto/...)
    -- en vez del público; se corrige a apps8.contraloria.gob.pe/SPIC.
    case when url_informe like 'http%'
         then regexp_replace(url_informe, '^https?://localhost(:[0-9]+)?/', 'http://apps8.contraloria.gob.pe/SPIC/') end as url_informe,
    case when url_resumen like 'http%'
         then regexp_replace(url_resumen, '^https?://localhost(:[0-9]+)?/', 'http://apps8.contraloria.gob.pe/SPIC/') end as url_resumen
from read_parquet('{{ var("control_parquet") }}')
where codigo_infobras is not null
