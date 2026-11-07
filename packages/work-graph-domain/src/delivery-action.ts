import { isNonBlankString } from "ts-base/strings";
import { WorkGraphError } from "./errors";
import type {
  DeliveryActionRequest,
  DeliveryRecoveryDelivery,
} from "./model";
import {
  DELIVERY_ACTION_KINDS,
  DELIVERY_RECOVERY_DELIVERY_KINDS,
  DELIVERY_RECOVERY_FALLBACKS,
} from "./vocabulary";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new WorkGraphError(
      "invalid_delivery_action",
      `${label} must be an ISO timestamp.`,
    );
  }
  return new Date(parsed).toISOString();
}

function text(value: string, label: string): string {
  if (!isNonBlankString(value)) {
    throw new WorkGraphError(
      "invalid_delivery_action",
      `${label} cannot be empty.`,
    );
  }
  return value.trim();
}

export function normalizeDeliveryActionRequest(
  input: DeliveryActionRequest,
): DeliveryActionRequest {
  const repository = input.repository.trim().toLowerCase();
  const expectedEvidenceKind =
    input.kind === "merge" ? "pull_request" : "deployment";
  if (
    !UUID_PATTERN.test(input.id) ||
    !(DELIVERY_ACTION_KINDS as readonly unknown[]).includes(input.kind) ||
    input.provider !== "github" ||
    input.evidenceKind !== expectedEvidenceKind ||
    !REPOSITORY_PATTERN.test(repository) ||
    !SHA_PATTERN.test(input.commitSha) ||
    !Number.isSafeInteger(input.policyRevision) ||
    input.policyRevision <= 0 ||
    !(DELIVERY_RECOVERY_FALLBACKS as readonly unknown[]).includes(
      input.unavailableSessionFallback,
    )
  ) {
    throw new WorkGraphError(
      "invalid_delivery_action",
      `Delivery action request ${input.id} is invalid.`,
    );
  }
  return {
    ...input,
    workItemId: text(input.workItemId, "workItemId"),
    evidenceExternalId: text(
      input.evidenceExternalId,
      "evidenceExternalId",
    ),
    repository,
    commitSha: input.commitSha.toLowerCase(),
    policyId: text(input.policyId, "policyId"),
    initiatingSessionId:
      input.initiatingSessionId === null
        ? null
        : text(input.initiatingSessionId, "initiatingSessionId"),
    requestedAt: timestamp(input.requestedAt, "requestedAt"),
  };
}

export function normalizeDeliveryRecoveryDelivery(
  input: DeliveryRecoveryDelivery,
): DeliveryRecoveryDelivery {
  if (
    !UUID_PATTERN.test(input.id) ||
    !UUID_PATTERN.test(input.recoveryId) ||
    !(DELIVERY_RECOVERY_DELIVERY_KINDS as readonly unknown[]).includes(
      input.kind,
    ) ||
    (input.kind === "push" && input.targetSessionId === null) ||
    (input.kind === "replacement_launch" && input.targetSessionId !== null)
  ) {
    throw new WorkGraphError(
      "invalid_delivery_recovery_delivery",
      `Delivery recovery reservation ${input.id} is invalid.`,
    );
  }
  return {
    ...input,
    targetSessionId:
      input.targetSessionId === null
        ? null
        : text(input.targetSessionId, "targetSessionId"),
    reservedAt: timestamp(input.reservedAt, "reservedAt"),
  };
}
