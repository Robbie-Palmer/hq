import { createHash } from "node:crypto";
import {
  type HousePriceIndexRelease,
  HousePriceIndexReleaseSchema,
} from "./schema";

export type HousePriceIndexReleaseStore = {
  hasRelease(checksum: string): Promise<boolean>;
  putRawSource(objectKey: string, raw: string): Promise<void>;
  putRelease(release: HousePriceIndexRelease): Promise<void>;
};

export async function storeHousePriceIndexRelease(
  store: HousePriceIndexReleaseStore,
  input: { raw: string; release: HousePriceIndexRelease },
): Promise<"stored" | "unchanged"> {
  const release = HousePriceIndexReleaseSchema.parse(input.release);
  const checksum = `sha256:${createHash("sha256").update(input.raw).digest("hex")}`;
  if (checksum !== release.source.checksum) {
    throw new Error("UK HPI raw source does not match the release checksum");
  }
  if (await store.hasRelease(release.source.checksum)) return "unchanged";
  await store.putRawSource(release.source.rawObjectKey, input.raw);
  await store.putRelease(release);
  return "stored";
}

export * from "./schema";
export * from "./propertyHistory";
export * from "./archive";
export * from "./comparables";
export * from "./marketTrend";
export * from "./pricePaid";
export * from "./pricePaidSchema";
