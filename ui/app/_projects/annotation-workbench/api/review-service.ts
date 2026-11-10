import {
  type ReviewEvent,
  type ReviewSession,
  reviewEventSchema,
  reviewSessionSchema,
} from "../domain/review-contract";

function serviceUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function assetUrl(baseUrl: string, assetId: string): string {
  return serviceUrl(baseUrl, `/api/v1/assets/${encodeURIComponent(assetId)}`);
}

export async function loadReviewSession(
  baseUrl: string,
): Promise<ReviewSession> {
  const response = await fetch(serviceUrl(baseUrl, "/api/v1/session"), {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Review service returned ${response.status}`);
  return reviewSessionSchema.parse(await response.json());
}

export async function saveReview(
  baseUrl: string,
  event: ReviewEvent,
): Promise<ReviewEvent> {
  const response = await fetch(serviceUrl(baseUrl, "/api/v1/reviews"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reviewEventSchema.parse(event)),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ?? `Review service returned ${response.status}`,
    );
  }
  return reviewEventSchema.parse(await response.json());
}
