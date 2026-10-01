import { sql } from "drizzle-orm";
import {
  operationalReport,
  type AnalyticsScope,
  type OperationalEvent,
} from "work-graph-domain";
import type { Db } from "./connection";
import { event } from "./schema";

/** Owner-only batch reader. Deliberately absent from the HTTP repository contract. */
export async function readOperationalReport(
  db: Db,
  period: { readonly start: string; readonly end: string },
) {
  // Validate before opening a database transaction.
  operationalReport([], [], period);
  return db.transaction(
    async (transaction) => {
      const events = await transaction
        .select({
          sequence: event.sequence,
          type: event.type,
          workItemId: event.workItemId,
          occurredAt: event.occurredAt,
          // Redact at the query boundary. Free-form kind strings are also untrusted.
          data: sql<
            Record<string, unknown>
          >`jsonb_strip_nulls(jsonb_build_object(
        'attentionRequestId', ${event.data}->'attentionRequestId',
        'kind', case when ${event.type} = 'note.created' then ${event.data}->'kind'
          when ${event.data}->>'kind' in ('decision','ambiguity','authority','access','failure','review','approval','scope') then ${event.data}->'kind'
          else '"other"'::jsonb end,
        'blocking', ${event.data}->'blocking',
        'leaseId', ${event.data}->'leaseId',
        'expiresAt', ${event.data}->'expiresAt',
        'outcome', ${event.data}->'outcome'
      ))`,
        })
        .from(event)
        .where(
          sql`${event.type} in ('attention.requested', 'attention.resolved', 'lease.claimed', 'lease.renewed', 'lease.ended', 'note.created')`,
        )
        .orderBy(event.sequence);
      const scopes = await transaction.execute<
        AnalyticsScope & Record<string, unknown>
      >(sql`
      with recursive assignments as (
        select work_item_id, scheduling_project_id, scheduling_initiative_id
        from work_item_priority_contexts
        union all
        select hierarchy.child_work_item_id, assignments.scheduling_project_id,
          assignments.scheduling_initiative_id
        from assignments join work_item_hierarchy hierarchy
          on hierarchy.parent_work_item_id = assignments.work_item_id
      )
      select work_item_id as "workItemId", scheduling_project_id as "projectId",
        scheduling_initiative_id as "initiativeId" from assignments
    `);
      return operationalReport(
        events.map(
          (row): OperationalEvent => ({
            ...row,
            occurredAt: row.occurredAt.toISOString(),
          }),
        ),
        scopes,
        period,
      );
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
