-- El saldo por ejecutar no puede ser mayor que el costo actualizado (tolerancia de S/ 1 por redondeo).
select * from {{ ref('fct_obras') }}
where saldo_por_ejecutar > costo_actualizado + 1
