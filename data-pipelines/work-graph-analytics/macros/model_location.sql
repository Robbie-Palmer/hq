{% macro model_location(filename) -%}
  {{ return(var('output_root') ~ '/' ~ var('model_version') ~ '/' ~ filename) }}
{%- endmacro %}
