import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  attentionRequest,
  attentionResolution,
  lease,
  workItem,
  workItemDependency,
  workItemHierarchy,
} from "../schema";

const blockingWorkItem = alias(workItem, "blocking_work_item");
const childWorkItem = alias(workItem, "child_work_item");

export const claimableWorkItemWhere = (workItemId?: string) =>
  and(
    eq(workItem.lifecycle, "open"),
    workItemId === undefined ? undefined : eq(workItem.id, workItemId),
    sql`not exists (
      select 1
      from ${attentionRequest}
      where ${attentionRequest.workItemId} = ${workItem.id}
        and ${attentionRequest.blocking} = true
        and not exists (
          select 1
          from ${attentionResolution}
          where ${attentionResolution.attentionRequestId} =
            ${attentionRequest.id}
        )
    )`,
    sql`not exists (
      select 1
      from ${workItemHierarchy}
      inner join ${workItem} as ${sql.identifier("child_work_item")}
        on ${childWorkItem.id} = ${workItemHierarchy.childWorkItemId}
      where ${workItemHierarchy.parentWorkItemId} = ${workItem.id}
        and ${childWorkItem.lifecycle} = 'open'
    )`,
    sql`not exists (
      with recursive ancestor_work_items(work_item_id) as (
        select ${workItem.id}
        union all
        select ${workItemHierarchy.parentWorkItemId}
        from ${workItemHierarchy}
        inner join ancestor_work_items
          on ${workItemHierarchy.childWorkItemId} =
            ancestor_work_items.work_item_id
      )
      select 1
      from ancestor_work_items
      inner join ${workItemDependency}
        on ${workItemDependency.dependentWorkItemId} =
          ancestor_work_items.work_item_id
      inner join ${workItem} as ${sql.identifier("blocking_work_item")}
        on ${blockingWorkItem.id} = ${workItemDependency.blockerWorkItemId}
      where ${blockingWorkItem.lifecycle} = 'open'
    )`,
    sql`not exists (
      select 1
      from ${lease}
      where ${lease.workItemId} = ${workItem.id}
        and ${lease.endedAt} is null
        and ${lease.expiresAt} > clock_timestamp()
    )`,
  );
