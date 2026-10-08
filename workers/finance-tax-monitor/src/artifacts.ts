import {
  govUkContentSnapshotSchema,
  type GovUkContentSnapshot,
  type GovUkSourceSpec,
} from "finance-tax-rules/gov-uk-monitor";
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { sha256Hex } from "ts-base/crypto";
import { canonicalJson } from "ts-base/json";

const PREFIX = "govuk-tax-guidance";

export type StoredSourceArtifacts = {
  sourceId: string;
  retrievedAt: string;
  rawChecksum: string;
  normalizedFingerprint: string;
  rawObjectKey: string;
  normalizedObjectKey: string;
  rawByteLength: number;
  publicationAt: string;
  responseEtag: string | null;
  responseLastModified: string | null;
};

function rawObjectKey(sourceId: string, checksum: string): string {
  return `${PREFIX}/${sourceId}/raw/${checksum}.json.gz`;
}

function normalizedObjectKey(sourceId: string, fingerprint: string): string {
  return `${PREFIX}/${sourceId}/normalized/${fingerprint}.json.gz`;
}

async function putCompressedJson(
  bucket: R2Bucket,
  key: string,
  body: string,
  customMetadata: Record<string, string>,
): Promise<void> {
  if (await bucket.head(key)) return;
  await bucket.put(key, gzipSync(strToU8(body)), {
    httpMetadata: {
      contentEncoding: "gzip",
      contentType: "application/json",
    },
    customMetadata,
  });
}

export async function archiveGovUkResponse(
  bucket: R2Bucket,
  source: GovUkSourceSpec,
  rawBody: string,
  snapshot: GovUkContentSnapshot,
  response: Pick<Response, "headers">,
  retrievedAt: string,
): Promise<StoredSourceArtifacts> {
  const rawChecksum = await sha256Hex(rawBody);
  const rawKey = rawObjectKey(source.id, rawChecksum);
  const normalizedKey = normalizedObjectKey(source.id, snapshot.fingerprint);
  const metadata = { sourceId: source.id, retrievedAt };
  await putCompressedJson(bucket, rawKey, rawBody, {
    ...metadata,
    sha256: rawChecksum,
    representation: "raw-content-api-response",
  });
  await putCompressedJson(bucket, normalizedKey, canonicalJson(snapshot), {
    ...metadata,
    sha256: snapshot.fingerprint,
    representation: "normalized-content-snapshot",
  });
  return {
    sourceId: source.id,
    retrievedAt,
    rawChecksum,
    normalizedFingerprint: snapshot.fingerprint,
    rawObjectKey: rawKey,
    normalizedObjectKey: normalizedKey,
    rawByteLength: strToU8(rawBody).byteLength,
    publicationAt: snapshot.metadata.publicUpdatedAt,
    responseEtag: response.headers.get("etag"),
    responseLastModified: response.headers.get("last-modified"),
  };
}

export async function readNormalizedSnapshot(
  bucket: R2Bucket,
  key: string,
): Promise<GovUkContentSnapshot> {
  const object = await bucket.get(key);
  if (!object) throw new Error(`Missing normalized GOV.UK snapshot ${key}`);
  const compressed = new Uint8Array(await object.arrayBuffer());
  return govUkContentSnapshotSchema.parse(
    JSON.parse(strFromU8(gunzipSync(compressed))),
  );
}
