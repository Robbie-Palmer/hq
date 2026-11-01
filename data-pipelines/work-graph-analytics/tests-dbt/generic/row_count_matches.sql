{% test row_count_matches(model, other_model) %}
select 1
where (select count(*) from {{ model }}) <> (select count(*) from {{ other_model }})
{% endtest %}
