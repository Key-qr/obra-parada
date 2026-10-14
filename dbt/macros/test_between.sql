{#- Test genérico: el valor cae en [min, max] (los nulos pasan). -#}
{% test between(model, column_name, min_value, max_value) %}
select * from {{ model }}
where {{ column_name }} is not null
  and ({{ column_name }} < {{ min_value }} or {{ column_name }} > {{ max_value }})
{% endtest %}
