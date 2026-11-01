import { sql, type SQL } from "drizzle-orm";
import type { WorkStage } from "work-graph-domain";

export interface WorkItemPageQueryInput {
  readonly cursor?: string;
  readonly limit: number;
  readonly selectionWhere?: SQL;
  readonly stage?: WorkStage;
}

export interface WorkItemPageRow extends Record<string, unknown> {
  readonly currentLeaseAcquiredAt: Date | string | null;
  readonly currentLeaseEndedAt: Date | string | null;
  readonly currentLeaseEpoch: number | null;
  readonly currentLeaseExpiresAt: Date | string | null;
  readonly currentLeaseId: string | null;
  readonly currentLeaseOutcome: string | null;
  readonly currentLeaseWorkerId: string | null;
  readonly donatedFromWorkItemId: string | null;
  readonly effectiveExpedited: boolean;
  readonly expediteReason: string | null;
  readonly expedited: boolean;
  readonly id: string;
  readonly initiativeRank: number;
  readonly lifecycle: "open" | "released" | "cancelled";
  readonly parentId: string | null;
  readonly priorityRank: number | null;
  readonly priorityExpedited: boolean;
  readonly projectRank: number;
  readonly rank: number | null;
  readonly schedulingInitiativeId: string | null;
  readonly schedulingProjectId: string | null;
  readonly stage: WorkStage;
  readonly ticketRank: number;
  readonly title: string;
}

/**
 * Project and page the queue in PostgreSQL. The recursive relations compute the
 * same inherited priority and dependency donation used by the domain model,
 * but the final LIMIT prevents unrelated work-item rows from crossing the
 * database boundary.
 */
export const workItemPageQuery = ({
  cursor,
  limit,
  selectionWhere,
  stage,
}: WorkItemPageQueryInput): SQL => sql`
  with recursive
    database_clock as (
      select clock_timestamp() as database_now
    ),
    lineage(descendant_id, ancestor_id, depth) as (
      select candidate.id, candidate.id, 0
      from work_items candidate
      union all
      select
        lineage.descendant_id,
        hierarchy.parent_work_item_id,
        lineage.depth + 1
      from lineage
      inner join work_item_hierarchy hierarchy
        on hierarchy.child_work_item_id = lineage.ancestor_id
    ),
    lineage_rows as (
      select
        lineage.descendant_id,
        lineage.ancestor_id,
        lineage.depth,
        ancestor.expedited,
        hierarchy.rank,
        priority.rank as priority_rank,
        priority.scheduling_initiative_id,
        priority.scheduling_project_id
      from lineage
      inner join work_items ancestor on ancestor.id = lineage.ancestor_id
      left join work_item_hierarchy hierarchy
        on hierarchy.child_work_item_id = ancestor.id
      left join work_item_priority_contexts priority
        on priority.work_item_id = ancestor.id
    ),
    scheduling_owners as (
      select distinct on (descendant_id)
        descendant_id,
        ancestor_id as owner_id,
        priority_rank,
        scheduling_initiative_id,
        scheduling_project_id
      from lineage_rows
      order by
        descendant_id,
        (priority_rank is not null) desc,
        depth
    ),
    scope_ranks as (
      select
        id,
        kind,
        row_number() over (
          partition by kind
          order by (rank is null), rank, id collate "C"
        )::integer as ordinal_rank
      from knowledge_scopes
    ),
    scope_counts as (
      select
        count(*) filter (where kind = 'initiative')::integer as initiative_count,
        count(*) filter (where kind = 'project')::integer as project_count
      from knowledge_scopes
    ),
    ticket_ranks as (
      select
        work_item_id,
        row_number() over (
          partition by scheduling_project_id
          order by rank, work_item_id collate "C"
        )::integer as ordinal_rank
      from work_item_priority_contexts
      where rank is not null
    ),
    ticket_counts as (
      select scheduling_project_id, count(*)::integer as ticket_count
      from work_item_priority_contexts
      where rank is not null
      group by scheduling_project_id
    ),
    lineage_aggregates as (
      select
        descendant_id,
        bool_or(expedited) as expedited,
        array_agg(
          (
            lpad(coalesce(rank, 2147483648)::text, 10, '0') || ':' || ancestor_id
          ) collate "C"
          order by depth desc
        ) as path_key
      from lineage_rows
      group by descendant_id
    ),
    base_priority_values as (
      select
        item.id,
        item.title,
        item.lifecycle,
        hierarchy.parent_work_item_id as parent_id,
        hierarchy.rank,
        direct_priority.rank as priority_rank,
        direct_priority.scheduling_initiative_id,
        direct_priority.scheduling_project_id,
        item.expedited as stored_expedited,
        item.expedite_reason,
        aggregate.expedited,
        aggregate.path_key,
        coalesce(
          initiative_scope.ordinal_rank,
          floor(scope_counts.initiative_count / 2.0)::integer + 1
        ) as initiative_rank,
        coalesce(
          project_scope.ordinal_rank,
          floor(scope_counts.project_count / 2.0)::integer + 1
        ) as project_rank,
        coalesce(
          ticket_rank.ordinal_rank,
          floor(coalesce(ticket_count.ticket_count, 0) / 2.0)::integer + 1
        ) as ticket_rank
      from work_items item
      inner join scheduling_owners owner on owner.descendant_id = item.id
      inner join lineage_aggregates aggregate on aggregate.descendant_id = item.id
      cross join scope_counts
      left join work_item_hierarchy hierarchy
        on hierarchy.child_work_item_id = item.id
      left join work_item_priority_contexts direct_priority
        on direct_priority.work_item_id = item.id
      left join scope_ranks initiative_scope
        on initiative_scope.kind = 'initiative'
        and initiative_scope.id = owner.scheduling_initiative_id
      left join scope_ranks project_scope
        on project_scope.kind = 'project'
        and project_scope.id = owner.scheduling_project_id
      left join ticket_ranks ticket_rank
        on ticket_rank.work_item_id = owner.owner_id
      left join ticket_counts ticket_count
        on ticket_count.scheduling_project_id is not distinct from owner.scheduling_project_id
    ),
    base_priorities as (
      select
        base_priority_values.*,
        (
          1.0::double precision / (10 + initiative_rank) +
          1.0::double precision / (10 + project_rank) +
          1.0::double precision / (10 + ticket_rank)
        ) as score
      from base_priority_values
    ),
    effective_waits(waiting_id, blocker_id) as (
      select distinct waiting.id, dependency.blocker_work_item_id
      from work_items waiting
      inner join lineage waiting_lineage
        on waiting_lineage.descendant_id = waiting.id
      inner join work_item_dependencies dependency
        on dependency.dependent_work_item_id = waiting_lineage.ancestor_id
      inner join work_items blocker
        on blocker.id = dependency.blocker_work_item_id
      where waiting.lifecycle = 'open'
        and blocker.lifecycle = 'open'
    ),
    donations(recipient_id, donor_id) as (
      select id, id from work_items
      union
      select waits.blocker_id, donations.donor_id
      from donations
      inner join effective_waits waits
        on waits.waiting_id = donations.recipient_id
    ),
    effective_priorities as (
      select distinct on (donations.recipient_id)
        donations.recipient_id,
        donations.donor_id,
        donor.expedited,
        donor.score,
        donor.path_key
      from donations
      inner join base_priorities donor on donor.id = donations.donor_id
      order by
        donations.recipient_id,
        donor.expedited desc,
        donor.score desc,
        donor.path_key,
        donor.id collate "C"
    ),
    projected_facts as (
      select
        base.*,
        effective.donor_id,
        effective.expedited as effective_expedited,
        effective.score as effective_score,
        effective.path_key as effective_path_key,
        current_lease.id as current_lease_id,
        current_lease.worker_id as current_lease_worker_id,
        current_lease.epoch as current_lease_epoch,
        current_lease.acquired_at as current_lease_acquired_at,
        current_lease.expires_at as current_lease_expires_at,
        current_lease.ended_at as current_lease_ended_at,
        current_lease.outcome as current_lease_outcome,
        database_clock.database_now,
        exists (
          select 1
          from attention_requests request
          left join attention_resolutions resolution
            on resolution.attention_request_id = request.id
          where request.work_item_id = base.id
            and request.blocking = true
            and resolution.id is null
        ) as has_unresolved_blocking_attention,
        exists (
          select 1
          from work_item_hierarchy child_hierarchy
          inner join work_items child
            on child.id = child_hierarchy.child_work_item_id
          where child_hierarchy.parent_work_item_id = base.id
            and child.lifecycle = 'open'
        ) as has_unfinished_direct_children,
        exists (
          select 1
          from lineage dependency_lineage
          inner join work_item_dependencies dependency
            on dependency.dependent_work_item_id = dependency_lineage.ancestor_id
          inner join work_items blocker
            on blocker.id = dependency.blocker_work_item_id
          where dependency_lineage.descendant_id = base.id
            and blocker.lifecycle = 'open'
        ) as has_unsatisfied_dependencies
      from base_priorities base
      inner join effective_priorities effective
        on effective.recipient_id = base.id
      cross join database_clock
      left join lateral (
        select active_lease.*
        from leases active_lease
        where active_lease.work_item_id = base.id
          and active_lease.ended_at is null
        limit 1
      ) current_lease on true
    ),
    projected as (
      select
        projected_facts.*,
        case
          when lifecycle <> 'open' then lifecycle::text
          when has_unresolved_blocking_attention then 'needs_attention'
          when current_lease_id is not null and current_lease_expires_at > database_now
            then 'in_progress'
          when current_lease_id is not null then 'stale'
          when has_unfinished_direct_children or has_unsatisfied_dependencies
            then 'blocked'
          else 'ready'
        end as stage
      from projected_facts
    ),
    selected_ordered as (
      select
        projected.*,
        row_number() over (
          order by
            projected.effective_expedited desc,
            projected.effective_score desc,
            projected.effective_path_key,
            projected.expedited desc,
            projected.score desc,
            projected.path_key,
            projected.id collate "C"
        ) as position
      from projected
      inner join work_items on work_items.id = projected.id
      where ${selectionWhere ?? sql`true`}
    ),
    cursor_position as (
      select position
      from selected_ordered
      where id = ${cursor ?? null}
    )
  select
    id,
    title,
    lifecycle,
    parent_id as "parentId",
    rank,
    priority_rank as "priorityRank",
    scheduling_initiative_id as "schedulingInitiativeId",
    scheduling_project_id as "schedulingProjectId",
    stored_expedited as "expedited",
    expedited as "priorityExpedited",
    expedite_reason as "expediteReason",
    stage,
    current_lease_id as "currentLeaseId",
    current_lease_worker_id as "currentLeaseWorkerId",
    current_lease_epoch as "currentLeaseEpoch",
    current_lease_acquired_at as "currentLeaseAcquiredAt",
    current_lease_expires_at as "currentLeaseExpiresAt",
    current_lease_ended_at as "currentLeaseEndedAt",
    current_lease_outcome as "currentLeaseOutcome",
    initiative_rank as "initiativeRank",
    project_rank as "projectRank",
    ticket_rank as "ticketRank",
    effective_expedited as "effectiveExpedited",
    case when donor_id = id then null else donor_id end as "donatedFromWorkItemId"
  from selected_ordered
  where
    (${cursor === undefined} or position > (select position from cursor_position))
    and (${stage === undefined} or stage = ${stage ?? null})
  order by position
  limit ${limit}
`;
