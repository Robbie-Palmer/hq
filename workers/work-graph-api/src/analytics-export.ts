import type {
  AnalyticsExportBatch,
  AnalyticsExportScope,
  StoredEvent,
  WorkGraphEventType,
} from "work-graph-db";
import { WORK_GRAPH_EVENT_TYPES } from "work-graph-db";
import { canonicalJson } from "ts-base/json";

const CHECKPOINT_KEY = "work-state/v1/checkpoint.json";
const EVENT_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = 1;
const SCOPE_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

const KNOWN_EVENT_TYPES = new Set<string>(WORK_GRAPH_EVENT_TYPES);
const ATTENTION_CATEGORIES = new Set([
  "decision",
  "ambiguity",
  "authority",
  "access",
  "failure",
  "review",
  "approval",
  "scope",
]);
const LEASE_OUTCOMES = new Set([
  "released",
  "cancelled",
  "decomposed",
  "attention_requested",
  "expired",
]);

export interface AnalyticsExportSource {
  readAnalyticsExportBatch(input: {
    readonly afterSequence: number;
    readonly limit: number;
  }): Promise<AnalyticsExportBatch>;
}

export interface StoredAnalyticsObject {
  readonly body: string;
  readonly version: string;
}

export interface AnalyticsObjectStore {
  compareAndSetCheckpoint(
    expectedVersion: string | null,
    body: string,
  ): Promise<boolean>;
  get(key: string): Promise<StoredAnalyticsObject | null>;
  putImmutable(
    key: string,
    body: string,
    contentType: string,
  ): Promise<void>;
}

interface ExportCheckpoint {
  readonly lastManifestKey: string | null;
  readonly schemaVersion: 1;
  readonly throughSequence: number;
}

interface ExportManifest {
  readonly batchId: string;
  readonly complete: true;
  readonly eventObject: {
    readonly bytes: number;
    readonly checksumSha256: string;
    readonly key: string;
    readonly rows: number;
    readonly schemaVersion: 1;
  };
  readonly fromSequenceExclusive: number;
  readonly manifestSchemaVersion: 1;
  readonly scopeObject: {
    readonly bytes: number;
    readonly checksumSha256: string;
    readonly key: string;
    readonly rows: number;
    readonly schemaVersion: 1;
  };
  readonly sourceUpperWatermark: number;
  readonly throughSequence: number;
}

export interface AnalyticsExportResult {
  readonly eventRows: number;
  readonly manifestKey: string | null;
  readonly objectBytes: number;
  readonly scopeRows: number;
  readonly status: "exported" | "no_events" | "resumed";
  readonly throughSequence: number;
}

export type AnalyticsExportFailureReason =
  | "checkpoint_conflict"
  | "checkpoint_schema_invalid"
  | "configuration_invalid"
  | "dependency_failure"
  | "event_schema_invalid"
  | "immutable_object_conflict"
  | "manifest_range_conflict"
  | "manifest_schema_invalid"
  | "published_object_invalid"
  | "source_range_invalid";

export class AnalyticsExportError extends Error {
  constructor(
    readonly reason: AnalyticsExportFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsExportError";
  }
}

export const analyticsExportFailureReason = (
  error: unknown,
): AnalyticsExportFailureReason =>
  error instanceof AnalyticsExportError ? error.reason : "dependency_failure";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseCheckpoint = (
  object: StoredAnalyticsObject | null,
): { checkpoint: ExportCheckpoint; version: string | null } => {
  if (object === null) {
    return {
      checkpoint: {
        schemaVersion: 1,
        throughSequence: 0,
        lastManifestKey: null,
      },
      version: null,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(object.body) as unknown;
  } catch {
    throw new AnalyticsExportError(
      "checkpoint_schema_invalid",
      "The analytics checkpoint has an unknown schema.",
    );
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    !Number.isSafeInteger(parsed.throughSequence) ||
    (parsed.throughSequence as number) < 0 ||
    (parsed.lastManifestKey !== null &&
      typeof parsed.lastManifestKey !== "string")
  ) {
    throw new AnalyticsExportError(
      "checkpoint_schema_invalid",
      "The analytics checkpoint has an unknown schema.",
    );
  }
  return {
    checkpoint: parsed as unknown as ExportCheckpoint,
    version: object.version,
  };
};

const byteLength = (value: string): number => encoder.encode(value).byteLength;
const compareIds = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const allowedEventType = (type: string): type is WorkGraphEventType =>
  KNOWN_EVENT_TYPES.has(type);

const stringField = (
  event: StoredEvent,
  field: string,
): string => {
  const value = event.data[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new AnalyticsExportError(
      "event_schema_invalid",
      `Unknown schema for Work Graph event '${event.type}' at sequence ${event.sequence}.`,
    );
  }
  return value;
};

const timestampField = (event: StoredEvent, field: string): string => {
  const value = stringField(event, field);
  if (!Number.isFinite(Date.parse(value))) {
    throw new AnalyticsExportError(
      "event_schema_invalid",
      `Unknown schema for Work Graph event '${event.type}' at sequence ${event.sequence}.`,
    );
  }
  return value;
};

const sanitizeNoteData = (event: StoredEvent): Record<string, unknown> => {
  const leaseId = event.data.leaseId;
  const storedKind = event.data.kind;
  // Early work-note events predate the kind marker but are lease-fenced.
  const kind =
    storedKind === undefined &&
    typeof leaseId === "string" &&
    leaseId.length > 0
      ? "work"
      : storedKind;
  if (
    (kind !== "work" && kind !== "post_release") ||
    (leaseId !== null && typeof leaseId !== "string") ||
    (kind === "work" && (typeof leaseId !== "string" || leaseId.length === 0))
  ) {
    throw new AnalyticsExportError(
      "event_schema_invalid",
      `Unknown schema for Work Graph event '${event.type}' at sequence ${event.sequence}.`,
    );
  }
  return { leaseId, kind };
};

const sanitizeEventData = (
  event: StoredEvent & { readonly type: WorkGraphEventType },
): Record<string, unknown> => {
  switch (event.type) {
    case "attention.requested": {
      const kind = stringField(event, "kind");
      if (typeof event.data.blocking !== "boolean") {
        throw new AnalyticsExportError(
          "event_schema_invalid",
          `Unknown schema for Work Graph event '${event.type}' at sequence ${event.sequence}.`,
        );
      }
      return {
        attentionRequestId: stringField(event, "attentionRequestId"),
        kind: ATTENTION_CATEGORIES.has(kind) ? kind : "other",
        blocking: event.data.blocking,
      };
    }
    case "attention.resolved":
      return {
        attentionRequestId: stringField(event, "attentionRequestId"),
      };
    case "lease.claimed":
    case "lease.renewed":
      return {
        leaseId: stringField(event, "leaseId"),
        expiresAt: timestampField(event, "expiresAt"),
      };
    case "lease.ended": {
      const outcome = stringField(event, "outcome");
      if (!LEASE_OUTCOMES.has(outcome)) {
        throw new AnalyticsExportError(
          "event_schema_invalid",
          `Unknown schema for Work Graph event '${event.type}' at sequence ${event.sequence}.`,
        );
      }
      return { leaseId: stringField(event, "leaseId"), outcome };
    }
    case "note.created":
      return sanitizeNoteData(event);
    default:
      return {};
  }
};

const sanitizeEvent = (event: StoredEvent): Record<string, unknown> => {
  if (!allowedEventType(event.type)) {
    throw new AnalyticsExportError(
      "event_schema_invalid",
      `Unknown Work Graph event type '${event.type}'.`,
    );
  }
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    sequence: event.sequence,
    type: event.type,
    workItemId: event.workItemId,
    occurredAt: event.occurredAt.toISOString(),
    data: sanitizeEventData(
      event as StoredEvent & { readonly type: WorkGraphEventType },
    ),
  };
};

const validateEventOrder = (
  events: readonly StoredEvent[],
  afterSequence: number,
  sourceUpperWatermark: number,
): void => {
  let previous = afterSequence;
  for (const event of events) {
    if (
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= previous ||
      event.sequence > sourceUpperWatermark
    ) {
      throw new AnalyticsExportError(
        "source_range_invalid",
        "The analytics source returned an invalid event range.",
      );
    }
    previous = event.sequence;
  }
};

const scopeDocument = (
  scopes: readonly AnalyticsExportScope[],
  capturedAt: string,
  eventWatermark: number,
): string =>
  canonicalJson({
    schemaVersion: SCOPE_SCHEMA_VERSION,
    capturedAt,
    eventWatermark,
    scopeBasis: "current_assignment",
    rows: scopes,
  });

const isObjectDescriptor = (
  value: unknown,
  keyPrefix: string,
): value is ExportManifest["eventObject"] | ExportManifest["scopeObject"] =>
  isRecord(value) &&
  typeof value.key === "string" &&
  value.key.startsWith(keyPrefix) &&
  value.schemaVersion === 1 &&
  Number.isSafeInteger(value.rows) &&
  (value.rows as number) >= 0 &&
  Number.isSafeInteger(value.bytes) &&
  (value.bytes as number) >= 0 &&
  typeof value.checksumSha256 === "string" &&
  SHA256_PATTERN.test(value.checksumSha256);

const parseManifest = (body: string): ExportManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new AnalyticsExportError(
      "manifest_schema_invalid",
      "The analytics manifest has an unknown schema.",
    );
  }
  if (
    !isRecord(parsed) ||
    parsed.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION ||
    parsed.complete !== true ||
    typeof parsed.batchId !== "string" ||
    !Number.isSafeInteger(parsed.fromSequenceExclusive) ||
    (parsed.fromSequenceExclusive as number) < 0 ||
    !Number.isSafeInteger(parsed.throughSequence) ||
    (parsed.throughSequence as number) <=
      (parsed.fromSequenceExclusive as number) ||
    !Number.isSafeInteger(parsed.sourceUpperWatermark) ||
    (parsed.sourceUpperWatermark as number) <
      (parsed.throughSequence as number) ||
    !isObjectDescriptor(parsed.eventObject, "work-state/v1/events/") ||
    !isObjectDescriptor(parsed.scopeObject, "work-state/v1/scopes/")
  ) {
    throw new AnalyticsExportError(
      "manifest_schema_invalid",
      "The analytics manifest has an unknown schema.",
    );
  }
  return parsed as unknown as ExportManifest;
};

const validatePublishedObject = async (
  store: AnalyticsObjectStore,
  descriptor: ExportManifest["eventObject"] | ExportManifest["scopeObject"],
): Promise<void> => {
  const object = await store.get(descriptor.key);
  if (
    object === null ||
    byteLength(object.body) !== descriptor.bytes ||
    (await sha256(object.body)) !== descriptor.checksumSha256
  ) {
    throw new AnalyticsExportError(
      "published_object_invalid",
      `Published analytics object '${descriptor.key}' is incomplete.`,
    );
  }
};

const checkpointBody = (
  throughSequence: number,
  manifestKey: string,
): string =>
  canonicalJson({
    schemaVersion: 1,
    throughSequence,
    lastManifestKey: manifestKey,
  } satisfies ExportCheckpoint);

const advanceCheckpoint = async (
  store: AnalyticsObjectStore,
  expectedVersion: string | null,
  throughSequence: number,
  manifestKey: string,
): Promise<void> => {
  if (
    !(await store.compareAndSetCheckpoint(
      expectedVersion,
      checkpointBody(throughSequence, manifestKey),
    ))
  ) {
    throw new AnalyticsExportError(
      "checkpoint_conflict",
      "The analytics checkpoint changed during publication.",
    );
  }
};

export async function exportAnalyticsBatch(
  source: AnalyticsExportSource,
  store: AnalyticsObjectStore,
  limit: number,
): Promise<AnalyticsExportResult> {
  const checkpointObject = await store.get(CHECKPOINT_KEY);
  const { checkpoint, version } = parseCheckpoint(checkpointObject);
  const batch = await source.readAnalyticsExportBatch({
    afterSequence: checkpoint.throughSequence,
    limit,
  });
  validateEventOrder(
    batch.events,
    checkpoint.throughSequence,
    batch.sourceUpperWatermark,
  );
  const lastEvent = batch.events.at(-1);
  if (lastEvent === undefined) {
    return {
      eventRows: 0,
      manifestKey: null,
      objectBytes: 0,
      scopeRows: 0,
      status: "no_events",
      throughSequence: checkpoint.throughSequence,
    };
  }

  const throughSequence = lastEvent.sequence;
  const batchId = `${checkpoint.throughSequence + 1}-${throughSequence}`;
  const manifestKey = `work-state/v1/manifests/${batchId}.json`;
  const publishedManifest = await store.get(manifestKey);
  if (publishedManifest !== null) {
    const manifest = parseManifest(publishedManifest.body);
    if (
      manifest.batchId !== batchId ||
      manifest.fromSequenceExclusive !== checkpoint.throughSequence ||
      manifest.throughSequence !== throughSequence ||
      manifest.sourceUpperWatermark < throughSequence
    ) {
      throw new AnalyticsExportError(
        "manifest_range_conflict",
        "The published analytics manifest conflicts with the source range.",
      );
    }
    await validatePublishedObject(store, manifest.eventObject);
    await validatePublishedObject(store, manifest.scopeObject);
    await advanceCheckpoint(store, version, throughSequence, manifestKey);
    return {
      eventRows: manifest.eventObject.rows,
      manifestKey,
      objectBytes: manifest.eventObject.bytes + manifest.scopeObject.bytes,
      scopeRows: manifest.scopeObject.rows,
      status: "resumed",
      throughSequence,
    };
  }

  const eventBody = `${batch.events.map(sanitizeEvent).map(canonicalJson).join("\n")}\n`;
  const eventChecksum = await sha256(eventBody);
  const eventKey = `work-state/v1/events/${batchId}-${eventChecksum}.ndjson`;
  const scopes = [...batch.scopes].sort((left, right) =>
    compareIds(left.workItemId, right.workItemId),
  );
  const scopeBody = scopeDocument(scopes, batch.capturedAt, throughSequence);
  const scopeChecksum = await sha256(scopeBody);
  const scopeKey = `work-state/v1/scopes/${throughSequence}-${scopeChecksum}.json`;
  const eventBytes = byteLength(eventBody);
  const scopeBytes = byteLength(scopeBody);
  const manifest = {
    batchId,
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    complete: true,
    fromSequenceExclusive: checkpoint.throughSequence,
    throughSequence,
    sourceUpperWatermark: batch.sourceUpperWatermark,
    eventObject: {
      key: eventKey,
      schemaVersion: EVENT_SCHEMA_VERSION,
      rows: batch.events.length,
      bytes: eventBytes,
      checksumSha256: eventChecksum,
    },
    scopeObject: {
      key: scopeKey,
      schemaVersion: SCOPE_SCHEMA_VERSION,
      rows: scopes.length,
      bytes: scopeBytes,
      checksumSha256: scopeChecksum,
    },
  } satisfies ExportManifest;

  await store.putImmutable(eventKey, eventBody, "application/x-ndjson");
  await store.putImmutable(scopeKey, scopeBody, "application/json");
  await store.putImmutable(
    manifestKey,
    canonicalJson(manifest),
    "application/json",
  );
  await advanceCheckpoint(store, version, throughSequence, manifestKey);

  return {
    eventRows: batch.events.length,
    manifestKey,
    objectBytes: eventBytes + scopeBytes,
    scopeRows: scopes.length,
    status: "exported",
    throughSequence,
  };
}

export class R2AnalyticsObjectStore implements AnalyticsObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async get(key: string): Promise<StoredAnalyticsObject | null> {
    const object = await this.bucket.get(key);
    if (object === null) return null;
    return { body: await object.text(), version: object.etag };
  }

  async putImmutable(
    key: string,
    body: string,
    contentType: string,
  ): Promise<void> {
    const created = await this.bucket.put(key, body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType },
    });
    if (created !== null) return;
    const existing = await this.get(key);
    if (existing?.body !== body) {
      throw new AnalyticsExportError(
        "immutable_object_conflict",
        `Immutable analytics object '${key}' already differs.`,
      );
    }
  }

  async compareAndSetCheckpoint(
    expectedVersion: string | null,
    body: string,
  ): Promise<boolean> {
    const written = await this.bucket.put(CHECKPOINT_KEY, body, {
      onlyIf:
        expectedVersion === null
          ? { etagDoesNotMatch: "*" }
          : { etagMatches: expectedVersion },
      httpMetadata: { contentType: "application/json" },
    });
    return written !== null;
  }
}
