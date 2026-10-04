import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  buildGovUkSourceRegistry,
  createRuleUpdateProposal,
  snapshotGovUkContent,
  type GovUkSourceSpec,
} from "finance-tax-rules/gov-uk-monitor";
import {
  archiveGovUkResponse,
  readNormalizedSnapshot,
  type StoredSourceArtifacts,
} from "./artifacts";
import { withDb } from "./db";
import type { Env } from "./env";
import {
  latestRevision,
  persistSuccessfulCheck,
  syncSourceAndReadState,
  type PersistedCheck,
  type RevisionPointer,
  type SourceScheduleState,
} from "./repository";

const FETCH_STEP: WorkflowStepConfig = {
  retries: { limit: 4, delay: "15 seconds", backoff: "exponential" },
  timeout: "2 minutes",
};

const DATABASE_STEP: WorkflowStepConfig = {
  retries: { limit: 4, delay: "5 seconds", backoff: "exponential" },
  timeout: "1 minute",
};

export type MonitorServices = {
  fetchImpl: typeof fetch;
  readSourceState(
    env: Env,
    source: GovUkSourceSpec,
  ): Promise<SourceScheduleState>;
  readLatestRevision(
    env: Env,
    sourceId: string,
  ): Promise<RevisionPointer | null>;
  persistCheck(
    env: Env,
    input: Parameters<typeof persistSuccessfulCheck>[1],
  ): Promise<PersistedCheck>;
};

const defaultServices: MonitorServices = {
  fetchImpl: fetch,
  readSourceState: (env, source) =>
    withDb(env, (db) => syncSourceAndReadState(db, source)),
  readLatestRevision: (env, sourceId) =>
    withDb(env, (db) => latestRevision(db, sourceId)),
  persistCheck: (env, input) =>
    withDb(env, (db) => persistSuccessfulCheck(db, input)),
};

export type TaxMonitorRunSummary = {
  checkedAt: string;
  checkedSourceIds: string[];
  skippedSourceIds: string[];
  reviewIds: string[];
  failures: Array<{ sourceId: string; message: string }>;
};

type SourceCheckResult =
  | { status: "checked"; sourceId: string; reviewId: string | null }
  | { status: "skipped"; sourceId: string }
  | { status: "failed"; sourceId: string; message: string };

export function isSourceDue(
  lastSuccessfulCheckAt: string | null,
  checkedAt: string,
  intervalHours: number,
): boolean {
  if (lastSuccessfulCheckAt === null) return true;
  const previous = new Date(lastSuccessfulCheckAt).valueOf();
  const current = new Date(checkedAt).valueOf();
  if (
    !Number.isFinite(previous) ||
    !Number.isFinite(current) ||
    !Number.isSafeInteger(intervalHours) ||
    intervalHours < 0
  ) {
    throw new Error("Invalid GOV.UK source monitoring interval or timestamp");
  }
  return current - previous >= intervalHours * 60 * 60 * 1_000;
}

export async function fetchAndArchiveSource(
  env: Env,
  source: GovUkSourceSpec,
  retrievedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredSourceArtifacts> {
  const response = await fetchImpl(source.contentApiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "personal-site-finance-tax-rule-monitor/2.0",
    },
  });
  if (!response.ok) {
    throw new Error(`GOV.UK Content API returned ${response.status}`);
  }
  const rawBody = await response.text();
  const snapshot = snapshotGovUkContent(JSON.parse(rawBody));
  return archiveGovUkResponse(
    env.SOURCE_ARTIFACTS,
    source,
    rawBody,
    snapshot,
    response,
    retrievedAt,
  );
}

export async function persistArchivedSource(
  env: Env,
  source: GovUkSourceSpec,
  artifacts: StoredSourceArtifacts,
  services: MonitorServices = defaultServices,
): Promise<PersistedCheck> {
  const candidate = await readNormalizedSnapshot(
    env.SOURCE_ARTIFACTS,
    artifacts.normalizedObjectKey,
  );
  const base = await services.readLatestRevision(env, source.id);
  const baseSnapshot = base
    ? await readNormalizedSnapshot(
        env.SOURCE_ARTIFACTS,
        base.normalizedObjectKey,
      )
    : null;
  const proposal = createRuleUpdateProposal(
    source,
    baseSnapshot,
    candidate,
    artifacts.retrievedAt,
  );
  return services.persistCheck(env, {
    source,
    artifacts,
    expectedBaseRevisionId: base?.id ?? null,
    proposal,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runSourceCheck(
  env: Env,
  step: WorkflowStep,
  source: GovUkSourceSpec,
  checkedAt: string,
  services: MonitorServices,
): Promise<SourceCheckResult> {
  try {
    const state = await step.do(
      `source-state:${source.id}`,
      DATABASE_STEP,
      () => services.readSourceState(env, source),
    );
    if (
      !isSourceDue(
        state.lastSuccessfulCheckAt,
        checkedAt,
        source.defaultCheckIntervalHours,
      )
    ) {
      return { status: "skipped", sourceId: source.id };
    }
    const artifacts = await step.do(
      `fetch-and-archive:${source.id}`,
      FETCH_STEP,
      () => fetchAndArchiveSource(env, source, checkedAt, services.fetchImpl),
    );
    const persisted = await step.do(
      `persist-revision:${source.id}`,
      DATABASE_STEP,
      () => persistArchivedSource(env, source, artifacts, services),
    );
    return {
      status: "checked",
      sourceId: source.id,
      reviewId: persisted.reviewId,
    };
  } catch (error) {
    return { status: "failed", sourceId: source.id, message: errorMessage(error) };
  }
}

export async function runTaxMonitor(
  env: Env,
  step: WorkflowStep,
  checkedAt: string,
  services: MonitorServices = defaultServices,
): Promise<TaxMonitorRunSummary> {
  const summary: TaxMonitorRunSummary = {
    checkedAt,
    checkedSourceIds: [],
    skippedSourceIds: [],
    reviewIds: [],
    failures: [],
  };
  const sourceResults = await Promise.all(
    buildGovUkSourceRegistry().map((source) =>
      runSourceCheck(env, step, source, checkedAt, services),
    ),
  );
  for (const result of sourceResults) {
    if (result.status === "skipped") {
      summary.skippedSourceIds.push(result.sourceId);
    } else if (result.status === "checked") {
      summary.checkedSourceIds.push(result.sourceId);
      if (result.reviewId) summary.reviewIds.push(result.reviewId);
    } else {
      const failure = { sourceId: result.sourceId, message: result.message };
      summary.failures.push(failure);
      console.error(
        JSON.stringify({ event: "tax-source-check-failed", ...failure }),
      );
    }
  }
  console.info(
    JSON.stringify({
      event: "tax-source-monitor-complete",
      checkedAt,
      checkedSources: summary.checkedSourceIds.length,
      skippedSources: summary.skippedSourceIds.length,
      pendingReviews: summary.reviewIds.length,
      failures: summary.failures.length,
    }),
  );
  if (summary.failures.length > 0) {
    throw new NonRetryableError(
      `${summary.failures.length} GOV.UK source check(s) failed after step retries`,
    );
  }
  return summary;
}

export class FinanceTaxMonitorWorkflow extends WorkflowEntrypoint<Env> {
  override async run(
    event: WorkflowEvent<unknown>,
    step: WorkflowStep,
  ): Promise<TaxMonitorRunSummary> {
    const scheduledTime = event.schedule?.scheduledTime;
    const checkedAt = new Date(scheduledTime ?? event.timestamp).toISOString();
    return runTaxMonitor(this.env, step, checkedAt);
  }
}
