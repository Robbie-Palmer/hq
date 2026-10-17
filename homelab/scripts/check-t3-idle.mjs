import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const t3Home = process.env.T3CODE_HOME ?? join(process.env.HOME ?? "/data/home", ".t3");
const explicitDatabase = process.env.T3_STATE_DATABASE;
const candidates = explicitDatabase
  ? [explicitDatabase]
  : [join(t3Home, "userdata/statev2.sqlite"), join(t3Home, "userdata/state.sqlite")];
const databasePath = candidates.find((path) => existsSync(path));

if (databasePath === undefined) {
  throw new Error(`T3 state database not found under ${t3Home}`);
}

const database = new DatabaseSync(databasePath, { readOnly: true });

function hasTable(name) {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

function legacyActivity() {
  const requiredTables = [
    "projection_threads",
    "projection_thread_sessions",
    "provider_session_runtime",
  ];
  if (!requiredTables.every(hasTable)) {
    throw new Error(`Unsupported legacy T3 database schema in ${databasePath}`);
  }

  return database
    .prepare(`
      SELECT
        threads.thread_id AS threadId,
        CASE
          WHEN sessions.active_turn_id IS NOT NULL THEN 'active turn'
          WHEN sessions.status IN ('running', 'starting') THEN 'thread session ' || sessions.status
          WHEN runtime.status IN ('running', 'starting') THEN 'provider runtime ' || runtime.status
          WHEN threads.pending_approval_count > 0 THEN 'pending approval'
          ELSE 'pending user input'
        END AS reason
      FROM projection_threads AS threads
      LEFT JOIN projection_thread_sessions AS sessions
        ON sessions.thread_id = threads.thread_id
      LEFT JOIN provider_session_runtime AS runtime
        ON runtime.thread_id = threads.thread_id
      WHERE sessions.active_turn_id IS NOT NULL
        OR sessions.status IN ('running', 'starting')
        OR runtime.status IN ('running', 'starting')
        OR threads.pending_approval_count > 0
        OR threads.pending_user_input_count > 0
      ORDER BY threads.thread_id
    `)
    .all();
}

function v2Activity() {
  const requiredTables = [
    "orchestration_v2_projection_nodes",
    "orchestration_v2_projection_provider_threads",
    "orchestration_v2_projection_runs",
    "orchestration_v2_projection_runtime_requests",
    "orchestration_v2_projection_subagents",
    "orchestration_v2_projection_turn_items",
  ];
  if (!requiredTables.every(hasTable)) {
    throw new Error(`Unsupported T3 orchestration-v2 database schema in ${databasePath}`);
  }

  const invalidPayloads = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM orchestration_v2_projection_provider_threads
      WHERE NOT json_valid(payload_json)
    `)
    .get().count;
  if (invalidPayloads > 0) {
    throw new Error(`Invalid provider-thread state in ${databasePath}`);
  }

  return database
    .prepare(`
      SELECT thread_id AS threadId, 'run ' || status AS reason
      FROM orchestration_v2_projection_runs
      WHERE status IN ('preparing', 'queued', 'starting', 'running', 'waiting')
      UNION ALL
      SELECT thread_id, 'pending runtime request'
      FROM orchestration_v2_projection_runtime_requests
      WHERE status = 'pending'
      UNION ALL
      SELECT thread_id, 'provider thread ' || status
      FROM orchestration_v2_projection_provider_threads
      WHERE status = 'active'
        OR json_array_length(payload_json, '$.pendingBackgroundTasks') > 0
      UNION ALL
      SELECT thread_id, 'subagent ' || status
      FROM orchestration_v2_projection_subagents
      WHERE status IN ('pending', 'running', 'waiting')
      UNION ALL
      SELECT thread_id, 'turn item ' || type || ' ' || status
      FROM orchestration_v2_projection_turn_items
      WHERE type IN ('command_execution', 'dynamic_tool', 'subagent')
        AND status IN ('pending', 'running', 'waiting')
      UNION ALL
      SELECT thread_id, 'execution node ' || kind || ' ' || status
      FROM orchestration_v2_projection_nodes
      WHERE status IN ('pending', 'running', 'waiting')
      ORDER BY threadId, reason
    `)
    .all();
}

const activity = hasTable("orchestration_v2_projection_runs")
  ? v2Activity()
  : legacyActivity();

if (activity.length > 0) {
  console.error(JSON.stringify({ databasePath, activity }, null, 2));
  process.exitCode = 20;
} else {
  console.log(JSON.stringify({ databasePath, idle: true }));
}
