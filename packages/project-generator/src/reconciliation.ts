import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import { z } from "zod";
import { compareUtcInstants, isUtcInstant } from "ts-base/dates";
import {
  answersPath,
  type ProjectPlan,
  type SharedManifestEdit,
  type TemplateSource,
} from "./contracts.js";
import {
  executeProjectPlan,
  type CheckResult,
  type GenerationResult,
} from "./engine.js";
import {
  manifestPathForEdit,
  SHARED_MANIFEST_PATHS,
} from "./manifests.js";
import { runCommand } from "./process.js";
import {
  projectProfileSchema,
  resolveProjectPolicies,
  resolveProjectProfile,
  type ProjectProfile,
  type ProjectProfileContracts,
  type ResolvedFulfillmentCheckpoint,
  type ResolvedProfilePolicy,
  type ResolvedProjectBlueprint,
  type ResolvedSelection,
} from "./profile.js";

const recordedSelectionSchema = z
  .object({
    id: z.string().min(1),
    layer: z.string().min(1),
    slot: z.string().min(1),
    kind: z.enum(["technology", "policy"]),
    value: z.string().min(1),
    source: z.enum(["default", "override"]),
    decision: z.string().min(1),
  })
  .strict();

const recordedBlueprintFields = {
  effective_at: z.string().min(1),
  project: z.looseObject({ id: z.string().min(1) }),
  selections: z.array(recordedSelectionSchema),
};

const recordedFulfillmentCheckpointSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    fulfillment: z.literal("manual"),
    status: z.enum(["pending", "verified"]),
    evidence: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (checkpoint.status === "verified" && checkpoint.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "must contain at least one item when a checkpoint is verified",
      });
    }
  });

const recordedBlueprintSchema = z.discriminatedUnion("schema_version", [
  z.looseObject({
    ...recordedBlueprintFields,
    schema_version: z.literal(1),
    manual_checkpoints: z.array(z.string()).default([]),
  }),
  z.looseObject({
    ...recordedBlueprintFields,
    schema_version: z.literal(2),
    fulfillment_checkpoints: z.array(recordedFulfillmentCheckpointSchema),
  }),
]);

const receiptSchema = z.looseObject({
    _commit: z.string().regex(/^[0-9a-f]{40}$/),
    _src_path: z.string().min(1),
    blueprint: recordedBlueprintSchema,
  });

export type SemanticChangeKind = "added" | "removed" | "replaced";
export type ReconciliationDisposition =
  | "automatic"
  | "migration"
  | "manual_decision";

export interface PolicyChange {
  readonly kind: SemanticChangeKind;
  readonly disposition: Exclude<ReconciliationDisposition, "manual_decision">;
  readonly layer: string;
  readonly slot: string;
  readonly previous?: ResolvedProfilePolicy;
  readonly current?: ResolvedProfilePolicy;
}

export interface DefaultSelectionChange {
  readonly kind: SemanticChangeKind;
  readonly disposition: Exclude<ReconciliationDisposition, "manual_decision">;
  readonly slot: string;
  readonly previous?: ResolvedSelection;
  readonly current?: ResolvedSelection;
}

export interface LocalOverrideReview {
  readonly disposition: "manual_decision";
  readonly slot: string;
  readonly previous?: ResolvedSelection;
  readonly current?: ResolvedSelection;
  readonly status: "added" | "removed" | "changed" | "preserved";
}

export interface ReconciliationAction {
  readonly kind:
    | "policy_change"
    | "default_change"
    | "local_override"
    | "fulfillment_checkpoint"
    | "template_update"
    | "repository_edit";
  readonly summary: string;
  readonly path?: string;
}

export interface ReconciliationPlanResult {
  readonly schemaVersion: 1;
  readonly kind: "project_reconciliation";
  readonly projectId: string;
  readonly status: "ready" | "frozen" | "deferred";
  readonly baseRevision: string;
  readonly recordedEffectiveAt: string;
  readonly targetEffectiveAt: string;
  readonly recordedTemplateSource: string;
  readonly targetTemplateSource: string;
  readonly recordedTemplateRevision: string;
  readonly targetTemplateRevision: string;
  readonly policyChanges: readonly PolicyChange[];
  readonly defaultChanges: readonly DefaultSelectionChange[];
  readonly localOverrides: readonly LocalOverrideReview[];
  readonly actions: {
    readonly automaticEdits: readonly ReconciliationAction[];
    readonly migrations: readonly ReconciliationAction[];
    readonly manualDecisions: readonly ReconciliationAction[];
  };
  readonly blockedReason?: string;
  readonly deferral?: {
    readonly effectiveAt: string;
    readonly reason: string;
  };
  readonly candidate: {
    readonly changedPaths: readonly string[];
    readonly checks: readonly CheckResult[];
    readonly diff: string;
  } | null;
  readonly planDigest: string;
}

export interface ReconciliationInput {
  readonly repository: string;
  readonly plan: ProjectPlan;
  readonly template: TemplateSource & { readonly revision: string };
  readonly profile: ProjectProfile;
  readonly contracts: ProjectProfileContracts;
  readonly blueprint: ResolvedProjectBlueprint;
}

export interface ReconciliationApplyResult {
  readonly schemaVersion: 1;
  readonly kind: "project_reconciliation_apply";
  readonly projectId: string;
  readonly reviewedPlanDigest: string;
  readonly generation: GenerationResult;
}

export interface ReconciliationSemanticDiff {
  readonly policyChanges: readonly PolicyChange[];
  readonly defaultChanges: readonly DefaultSelectionChange[];
  readonly localOverrides: readonly LocalOverrideReview[];
}

interface RecordedReceipt {
  readonly commit: string;
  readonly source: string;
  readonly blueprint: z.infer<typeof recordedBlueprintSchema> & {
    readonly effective_at: string;
    readonly selections: readonly ResolvedSelection[];
  };
}

function normalizeRecordedInstant(value: string): string {
  if (isUtcInstant(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new TypeError(`Recorded blueprint has invalid effective_at '${value}'`);
  }
  return parsed.toISOString().replace(".000Z", "Z");
}

async function repositoryRoot(repository: string): Promise<string> {
  return (
    await runCommand("git", ["-C", repository, "rev-parse", "--show-toplevel"])
  ).stdout.trim();
}

async function readRecordedReceipt(
  repository: string,
  projectId: string,
): Promise<RecordedReceipt> {
  const root = await repositoryRoot(repository);
  const receiptPath = path.join(root, answersPath(projectId));
  let source: string;
  try {
    source = await readFile(receiptPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Cannot reconcile project: Copier answers file '${answersPath(projectId)}' does not exist`,
      );
    }
    throw error;
  }
  const receipt = receiptSchema.parse(parse(source));
  if (receipt.blueprint.project.id !== projectId) {
    throw new Error(
      `Cannot reconcile project '${projectId}': its receipt records project '${receipt.blueprint.project.id}'`,
    );
  }
  return {
    commit: receipt._commit,
    source: receipt._src_path,
    blueprint: {
      ...receipt.blueprint,
      effective_at: normalizeRecordedInstant(receipt.blueprint.effective_at),
      selections: receipt.blueprint.selections,
    },
  };
}

function templateSourceMatches(recorded: string, expected: string): boolean {
  if (recorded === expected) return true;
  return path.isAbsolute(recorded) && path.isAbsolute(expected)
    ? path.normalize(recorded) === path.normalize(expected)
    : false;
}

function compareById<T extends { readonly id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id, "en");
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function policyChanges(
  previous: readonly ResolvedProfilePolicy[],
  current: readonly ResolvedProfilePolicy[],
): PolicyChange[] {
  const keys = new Set([
    ...previous.map(({ layer, slot }) => `${layer}\0${slot}`),
    ...current.map(({ layer, slot }) => `${layer}\0${slot}`),
  ]);
  const changes: PolicyChange[] = [];
  for (const key of [...keys].toSorted(compareStrings)) {
    const [layer = "", slot = ""] = key.split("\0");
    const oldPolicies = previous
      .filter((policy) => policy.layer === layer && policy.slot === slot)
      .toSorted(compareById);
    const newPolicies = current
      .filter((policy) => policy.layer === layer && policy.slot === slot)
      .toSorted(compareById);
    const oldById = new Map(oldPolicies.map((policy) => [policy.id, policy]));
    const newById = new Map(newPolicies.map((policy) => [policy.id, policy]));
    const removed = oldPolicies.filter(({ id }) => !newById.has(id));
    const added = newPolicies.filter(({ id }) => !oldById.has(id));
    for (const oldPolicy of oldPolicies) {
      const newPolicy = newById.get(oldPolicy.id);
      if (newPolicy && !isDeepStrictEqual(oldPolicy, newPolicy)) {
        changes.push({
          kind: "replaced",
          disposition: "migration",
          layer,
          slot,
          previous: oldPolicy,
          current: newPolicy,
        });
      }
    }
    if (removed.length === 1 && added.length === 1) {
      changes.push({
        kind: "replaced",
        disposition: "migration",
        layer,
        slot,
        previous: removed[0],
        current: added[0],
      });
      continue;
    }
    changes.push(
      ...removed.map((policy) => ({
        kind: "removed" as const,
        disposition: "migration" as const,
        layer,
        slot,
        previous: policy,
      })),
      ...added.map((policy) => ({
        kind: "added" as const,
        disposition: "automatic" as const,
        layer,
        slot,
        current: policy,
      })),
    );
  }
  return changes;
}

function defaultChanges(
  previous: readonly ResolvedSelection[],
  current: readonly ResolvedSelection[],
): DefaultSelectionChange[] {
  const oldDefaults = previous.filter(({ source }) => source === "default");
  const newDefaults = current.filter(({ source }) => source === "default");
  const slots = new Set([
    ...oldDefaults.map(({ slot }) => slot),
    ...newDefaults.map(({ slot }) => slot),
  ]);
  const changes: DefaultSelectionChange[] = [];
  for (const slot of [...slots].toSorted(compareStrings)) {
    const oldSelections = oldDefaults
      .filter((selection) => selection.slot === slot)
      .toSorted(compareById);
    const newSelections = newDefaults
      .filter((selection) => selection.slot === slot)
      .toSorted(compareById);
    const oldById = new Map(oldSelections.map((selection) => [selection.id, selection]));
    const newById = new Map(newSelections.map((selection) => [selection.id, selection]));
    const removed = oldSelections.filter(({ id }) => !newById.has(id));
    const added = newSelections.filter(({ id }) => !oldById.has(id));
    for (const oldSelection of oldSelections) {
      const newSelection = newById.get(oldSelection.id);
      if (newSelection && !isDeepStrictEqual(oldSelection, newSelection)) {
        changes.push({
          kind: "replaced",
          disposition: "migration",
          slot,
          previous: oldSelection,
          current: newSelection,
        });
      }
    }
    if (removed.length === 1 && added.length === 1) {
      changes.push({
        kind: "replaced",
        disposition: "migration",
        slot,
        previous: removed[0],
        current: added[0],
      });
      continue;
    }
    changes.push(
      ...removed.map((selection) => ({
        kind: "removed" as const,
        disposition: "migration" as const,
        slot,
        previous: selection,
      })),
      ...added.map((selection) => ({
        kind: "added" as const,
        disposition: "automatic" as const,
        slot,
        current: selection,
      })),
    );
  }
  return changes;
}

function localOverrideReviews(
  previous: readonly ResolvedSelection[],
  current: readonly ResolvedSelection[],
): LocalOverrideReview[] {
  const oldOverrides = previous.filter(({ source }) => source === "override");
  const newOverrides = current.filter(({ source }) => source === "override");
  const slots = new Set([
    ...oldOverrides.map(({ slot }) => slot),
    ...newOverrides.map(({ slot }) => slot),
  ]);
  return [...slots].toSorted(compareStrings).map((slot) => {
    const oldOverride = oldOverrides.find((selection) => selection.slot === slot);
    const newOverride = newOverrides.find((selection) => selection.slot === slot);
    let status: LocalOverrideReview["status"];
    if (oldOverride === undefined) {
      status = "added";
    } else if (newOverride === undefined) {
      status = "removed";
    } else if (
      oldOverride.id === newOverride.id &&
      oldOverride.value === newOverride.value &&
      oldOverride.decision === newOverride.decision
    ) {
      status = "preserved";
    } else {
      status = "changed";
    }
    return {
      disposition: "manual_decision",
      slot,
      previous: oldOverride,
      current: newOverride,
      status,
    };
  });
}

export function diffProjectReconciliation(input: {
  readonly previousPolicies: readonly ResolvedProfilePolicy[];
  readonly currentPolicies: readonly ResolvedProfilePolicy[];
  readonly previousDefaults: readonly ResolvedSelection[];
  readonly currentDefaults: readonly ResolvedSelection[];
  readonly previousSelections: readonly ResolvedSelection[];
  readonly currentSelections: readonly ResolvedSelection[];
}): ReconciliationSemanticDiff {
  return {
    policyChanges: policyChanges(
      input.previousPolicies,
      input.currentPolicies,
    ),
    defaultChanges: defaultChanges(
      input.previousDefaults,
      input.currentDefaults,
    ),
    localOverrides: localOverrideReviews(
      input.previousSelections,
      input.currentSelections,
    ),
  };
}

function policySummary(change: PolicyChange): string {
  if (change.kind === "added") {
    return `Adopt policy '${change.current?.id}' for '${change.slot}'.`;
  }
  if (change.kind === "removed") {
    return `Migrate away from policy '${change.previous?.id}' for '${change.slot}'.`;
  }
  return `Migrate policy '${change.slot}' from '${change.previous?.id}' to '${change.current?.id}'.`;
}

function defaultSummary(change: DefaultSelectionChange): string {
  if (change.kind === "added") {
    return `Adopt default '${change.current?.value}' for '${change.slot}'.`;
  }
  if (change.kind === "removed") {
    return `Migrate away from default '${change.previous?.value}' for '${change.slot}'.`;
  }
  return `Migrate default '${change.slot}' from '${change.previous?.value}' to '${change.current?.value}'.`;
}

function overrideSummary(review: LocalOverrideReview): string {
  if (review.status === "removed") {
    return `Review removal of local override '${review.slot}' from decision '${review.previous?.decision}'.`;
  }
  if (review.status === "preserved") {
    return `Preserve local override '${review.slot}' from decision '${review.current?.decision}'.`;
  }
  return `Review ${review.status} local override '${review.slot}' from decision '${review.current?.decision}'.`;
}

function appendPendingFulfillmentActions(
  checkpoints: readonly ResolvedFulfillmentCheckpoint[],
  actions: ReconciliationAction[],
): void {
  for (const checkpoint of checkpoints) {
    if (checkpoint.status !== "pending") continue;
    actions.push({
      kind: "fulfillment_checkpoint",
      summary: checkpoint.action,
    });
  }
}

function buildActions(input: {
  readonly policies: readonly PolicyChange[];
  readonly defaults: readonly DefaultSelectionChange[];
  readonly overrides: readonly LocalOverrideReview[];
  readonly checkpoints: readonly ResolvedFulfillmentCheckpoint[];
  readonly recordedTemplateRevision: string;
  readonly targetTemplateRevision: string;
  readonly changedPaths: readonly string[];
  readonly receiptPath: string;
  readonly sharedManifestEdits: readonly SharedManifestEdit[];
}): ReconciliationPlanResult["actions"] {
  const automaticEdits: ReconciliationAction[] = [];
  const migrations: ReconciliationAction[] = [];
  const manualDecisions: ReconciliationAction[] = [];
  for (const change of input.policies) {
    const action = { kind: "policy_change" as const, summary: policySummary(change) };
    (change.disposition === "automatic" ? automaticEdits : migrations).push(action);
  }
  for (const change of input.defaults) {
    const action = { kind: "default_change" as const, summary: defaultSummary(change) };
    (change.disposition === "automatic" ? automaticEdits : migrations).push(action);
  }
  for (const review of input.overrides) {
    manualDecisions.push({
      kind: "local_override",
      summary: overrideSummary(review),
    });
  }
  appendPendingFulfillmentActions(input.checkpoints, manualDecisions);
  if (input.recordedTemplateRevision !== input.targetTemplateRevision) {
    migrations.push({
      kind: "template_update",
      summary: `Update template revision from '${input.recordedTemplateRevision}' to '${input.targetTemplateRevision}'.`,
    });
  }
  for (const changedPath of input.changedPaths) {
    const action = {
      kind: "repository_edit" as const,
      summary: `Apply the reviewed change to '${changedPath}'.`,
      path: changedPath,
    };
    const replacesManifestRecord = input.sharedManifestEdits.some((edit) =>
      manifestPathForEdit(edit) === changedPath &&
      (edit.kind === "repository_project" || edit.kind === "catalog_record") &&
      edit.expected !== null &&
      !isDeepStrictEqual(edit.expected, edit.value)
    );
    if (
      changedPath === input.receiptPath ||
      (SHARED_MANIFEST_PATHS.has(changedPath) && !replacesManifestRecord)
    ) {
      automaticEdits.push(action);
    } else {
      migrations.push(action);
    }
  }
  return { automaticEdits, migrations, manualDecisions };
}

function reconciliationDigest(
  plan: Omit<ReconciliationPlanResult, "planDigest">,
): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export async function planProjectReconciliation(
  input: ReconciliationInput,
): Promise<ReconciliationPlanResult> {
  const recorded = await readRecordedReceipt(
    input.repository,
    input.blueprint.project.id,
  );
  if (!templateSourceMatches(recorded.source, input.template.source)) {
    throw new Error(
      `Cannot reconcile project: recorded template source does not match allowlisted template '${input.template.id}'`,
    );
  }
  if (
    compareUtcInstants(
      recorded.blueprint.effective_at,
      input.blueprint.effective_at,
    ) >= 0
  ) {
    throw new Error(
      `Reconciliation target '${input.blueprint.effective_at}' must be later than recorded blueprint '${recorded.blueprint.effective_at}'`,
    );
  }

  const profileWithoutOverrides = projectProfileSchema.parse({
    ...input.profile,
    overrides: [],
  });
  const recordedSlots = new Set(
    recorded.blueprint.selections.map(({ slot }) => slot),
  );
  const oldPolicies = resolveProjectPolicies(
    input.profile,
    input.contracts,
    recorded.blueprint.effective_at,
  ).filter(({ slot }) => recordedSlots.has(slot));
  const newPolicies = resolveProjectPolicies(
    input.profile,
    input.contracts,
    input.blueprint.effective_at,
  );
  const historicalPlatformDefaults = resolveProjectProfile(
    profileWithoutOverrides,
    input.contracts,
    recorded.blueprint.effective_at,
  ).selections;
  const recordedDefaults = recorded.blueprint.selections.filter(
    ({ source }) => source === "default",
  );
  const overriddenSlots = new Set(
    recorded.blueprint.selections
      .filter(({ source }) => source === "override")
      .map(({ slot }) => slot),
  );
  const oldDefaults = [
    ...new Map(
      [
        ...recordedDefaults,
        ...historicalPlatformDefaults.filter(({ slot }) =>
          overriddenSlots.has(slot),
        ),
      ].map((selection) => [selection.id, selection]),
    ).values(),
  ];
  const newDefaults = resolveProjectProfile(
    profileWithoutOverrides,
    input.contracts,
    input.blueprint.effective_at,
  ).selections;
  const semanticDiff = diffProjectReconciliation({
    previousPolicies: oldPolicies,
    currentPolicies: newPolicies,
    previousDefaults: oldDefaults,
    currentDefaults: newDefaults,
    previousSelections: recorded.blueprint.selections,
    currentSelections: input.blueprint.selections,
  });
  const policies = semanticDiff.policyChanges;
  const defaults = semanticDiff.defaultChanges;
  const overrides = semanticDiff.localOverrides;
  const reconciliationPolicy = input.profile.reconciliation;
  const deferral =
    reconciliationPolicy.mode === "tracking" &&
    reconciliationPolicy.defer !== undefined &&
    compareUtcInstants(
      reconciliationPolicy.defer.effective_at,
      input.blueprint.effective_at,
    ) === 0
      ? reconciliationPolicy.defer
      : undefined;
  let status: ReconciliationPlanResult["status"] = "ready";
  if (input.profile.reconciliation.mode === "frozen") {
    status = "frozen";
  } else if (deferral) {
    status = "deferred";
  }
  const blockedReason =
    input.profile.reconciliation.mode === "frozen"
      ? input.profile.reconciliation.reason
      : deferral?.reason;

  let generation: GenerationResult | undefined;
  if (status === "ready") {
    generation = await executeProjectPlan({
      repository: input.repository,
      mode: "plan",
      plan: input.plan,
      template: input.template,
    });
  }
  const root = await repositoryRoot(input.repository);
  const baseRevision = generation
    ? generation.baseRevision
    : (
        await runCommand("git", ["-C", root, "rev-parse", "HEAD"])
      ).stdout.trim();
  const changedPaths = generation?.changedPaths ?? [];
  const actions = buildActions({
    policies,
    defaults,
    overrides,
    checkpoints: input.blueprint.fulfillment_checkpoints,
    recordedTemplateRevision: recorded.commit,
    targetTemplateRevision: input.template.revision,
    changedPaths,
    receiptPath: answersPath(input.blueprint.project.id),
    sharedManifestEdits: input.plan.shared_manifest_edits,
  });
  const result: Omit<ReconciliationPlanResult, "planDigest"> = {
    schemaVersion: 1,
    kind: "project_reconciliation",
    projectId: input.blueprint.project.id,
    status,
    baseRevision,
    recordedEffectiveAt: recorded.blueprint.effective_at,
    targetEffectiveAt: input.blueprint.effective_at,
    recordedTemplateSource: recorded.source,
    targetTemplateSource: input.template.source,
    recordedTemplateRevision: recorded.commit,
    targetTemplateRevision: input.template.revision,
    policyChanges: policies,
    defaultChanges: defaults,
    localOverrides: overrides,
    actions,
    ...(blockedReason ? { blockedReason } : {}),
    ...(deferral
      ? {
          deferral: {
            effectiveAt: deferral.effective_at,
            reason: deferral.reason,
          },
        }
      : {}),
    candidate: generation
      ? {
          changedPaths: generation.changedPaths,
          checks: generation.checks,
          diff: generation.diff,
        }
      : null,
  };
  return { ...result, planDigest: reconciliationDigest(result) };
}

export async function applyProjectReconciliation(
  input: ReconciliationInput & { readonly reviewedPlanDigest: string },
): Promise<ReconciliationApplyResult> {
  const current = await planProjectReconciliation(input);
  if (current.status !== "ready") {
    throw new Error(
      `Cannot apply reconciliation while project status is '${current.status}'`,
    );
  }
  if (current.planDigest !== input.reviewedPlanDigest) {
    throw new Error(
      "Reviewed reconciliation plan does not match the current repository, profile, contracts, or template",
    );
  }
  if (!current.candidate) {
    throw new Error("Ready reconciliation did not produce a candidate");
  }
  const generation = await executeProjectPlan({
    repository: input.repository,
    mode: "update",
    plan: input.plan,
    template: input.template,
    expectedDiff: current.candidate.diff,
  });
  return {
    schemaVersion: 1,
    kind: "project_reconciliation_apply",
    projectId: input.blueprint.project.id,
    reviewedPlanDigest: input.reviewedPlanDigest,
    generation,
  };
}
