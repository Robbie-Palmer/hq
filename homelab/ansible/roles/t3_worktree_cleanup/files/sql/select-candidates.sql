.mode tabs
SELECT
  t.thread_id,
  t.worktree_path,
  CASE
    WHEN t.deleted_at IS NOT NULL THEN 'deleted'
    WHEN t.archived_at IS NOT NULL THEN 'archived'
    ELSE 'settled'
  END,
  COALESCE(t.deleted_at, t.archived_at, t.settled_at)
FROM projection_threads AS t
LEFT JOIN projection_thread_sessions AS s ON s.thread_id = t.thread_id
LEFT JOIN provider_session_runtime AS r ON r.thread_id = t.thread_id
WHERE t.worktree_path IS NOT NULL
  AND (@thread_id IS NULL OR t.thread_id = @thread_id)
  AND t.pinned_at IS NULL
  AND t.pending_approval_count = 0
  AND t.pending_user_input_count = 0
  AND COALESCE(s.status, 'stopped') NOT IN ('running', 'starting')
  AND s.active_turn_id IS NULL
  AND COALESCE(r.status, 'stopped') NOT IN ('running', 'starting')
  AND (
    (t.deleted_at IS NOT NULL AND julianday('now') - julianday(t.deleted_at) >= @deleted_days)
    OR (
      t.deleted_at IS NULL
      AND t.archived_at IS NOT NULL
      AND julianday('now') - julianday(t.archived_at) >= @archived_days
    )
    OR (
      t.deleted_at IS NULL
      AND t.archived_at IS NULL
      AND t.settled_at IS NOT NULL
      AND julianday('now') - julianday(t.settled_at) >= @settled_days
      AND julianday('now') - julianday(t.updated_at) >= @settled_days
    )
  )
ORDER BY COALESCE(t.deleted_at, t.archived_at, t.settled_at), t.thread_id;
