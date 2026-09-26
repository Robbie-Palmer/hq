DO $work_graph$
BEGIN
  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L',
    current_user,
    current_database(),
    '5s'
  );
  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
    current_user,
    current_database(),
    '15s'
  );
  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I SET idle_in_transaction_session_timeout = %L',
    current_user,
    current_database(),
    '10s'
  );
  EXECUTE format(
    'ALTER ROLE %I IN DATABASE %I SET transaction_timeout = %L',
    current_user,
    current_database(),
    '20s'
  );
END
$work_graph$;
