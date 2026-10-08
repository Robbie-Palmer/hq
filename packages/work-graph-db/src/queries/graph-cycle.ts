import { sql } from "drizzle-orm";
import {
  workItem,
  workItemDependency,
  workItemHierarchy,
} from "../schema";

export type GraphCycleRow = {
  hasCycle: boolean;
};

// Every item is its own descendant so an explicit dependency remains in the
// projection. The recursive rows add that dependency to every child. Hierarchy
// edges point from a waiting parent to its blocking child.
export const graphCycleQuery = sql<GraphCycleRow>`
  with recursive descendants(ancestor_id, descendant_id) as (
    select ${workItem.id}, ${workItem.id}
    from ${workItem}

    union

    select
      descendants.ancestor_id,
      ${workItemHierarchy.childWorkItemId}
    from descendants
    join ${workItemHierarchy}
      on ${workItemHierarchy.parentWorkItemId} = descendants.descendant_id
  ),
  waits_for(waiting_work_item_id, blocking_work_item_id) as (
    select
      ${workItemHierarchy.parentWorkItemId},
      ${workItemHierarchy.childWorkItemId}
    from ${workItemHierarchy}

    union

    select
      descendants.descendant_id,
      ${workItemDependency.blockerWorkItemId}
    from ${workItemDependency}
    join descendants
      on descendants.ancestor_id = ${workItemDependency.dependentWorkItemId}
  ),
  reachability(origin_work_item_id, reached_work_item_id) as (
    select waiting_work_item_id, blocking_work_item_id
    from waits_for

    union

    select
      reachability.origin_work_item_id,
      waits_for.blocking_work_item_id
    from reachability
    join waits_for
      on waits_for.waiting_work_item_id = reachability.reached_work_item_id
  )
  select exists (
    select 1
    from reachability
    where origin_work_item_id = reached_work_item_id
  ) as "hasCycle"
`;
