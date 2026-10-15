import type { Provenance } from "../src/model";

export const period = {
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: "2026-02-01T00:00:00.000Z",
} as const;

export function provenance(
  externalId: string,
  revision = "1",
  observedAt = "2026-02-02T00:00:00.000Z",
  ingestedAt = "2026-02-02T01:00:00.000Z",
): Provenance {
  return {
    source: {
      identity: {
        providerId: "provider:cloud",
        accountId: "account:primary",
        sourceType: "billing-line-item",
        externalId,
      },
      revision,
      observedAt,
      ingestedAt,
      ingestionRunId: `run:${revision}`,
    },
    method: {
      id: "collector:billing",
      version: "1.0.0",
    },
  };
}
