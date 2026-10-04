SELECT COUNT(*)
FROM pragma_table_info(@table_name)
WHERE name = @column_name;
