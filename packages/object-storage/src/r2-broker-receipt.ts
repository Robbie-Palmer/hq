import { randomBytes } from "node:crypto";
import { link, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

export const brokerBucketPrefixPattern =
  /^[a-z0-9](?:[a-z0-9-]{2,38}[a-z0-9])$/;

export type BrokerReceipt = {
  schemaVersion: 1;
  accountId: string;
  bucketPrefix: string;
  plannedBuckets: readonly [string, string];
  ownedBuckets: string[];
  pendingBuckets: string[];
  createdAt: string;
};

export function parseReceipt(source: string): BrokerReceipt {
  const value = JSON.parse(source) as Partial<BrokerReceipt>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.accountId !== "string" ||
    typeof value.bucketPrefix !== "string" ||
    !Array.isArray(value.plannedBuckets) ||
    value.plannedBuckets.length !== 2 ||
    !value.plannedBuckets.every((bucket) => typeof bucket === "string") ||
    !Array.isArray(value.ownedBuckets) ||
    !value.ownedBuckets.every((bucket) => typeof bucket === "string") ||
    !Array.isArray(value.pendingBuckets) ||
    !value.pendingBuckets.every((bucket) => typeof bucket === "string") ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("R2 broker receipt is invalid");
  }
  const [allowedBucket, deniedBucket] = value.plannedBuckets;
  const ownedBuckets = new Set(value.ownedBuckets);
  const pendingBuckets = new Set(value.pendingBuckets);
  if (
    !/^[a-f0-9]{32}$/i.test(value.accountId) ||
    !brokerBucketPrefixPattern.test(value.bucketPrefix) ||
    !allowedBucket ||
    !deniedBucket ||
    !new RegExp(`^${value.bucketPrefix}-[a-f0-9]{10}$`).test(allowedBucket) ||
    deniedBucket !== `${allowedBucket}-scope` ||
    ownedBuckets.size !== value.ownedBuckets.length ||
    pendingBuckets.size !== value.pendingBuckets.length ||
    !value.ownedBuckets.every((bucket) => value.plannedBuckets?.includes(bucket)) ||
    !value.pendingBuckets.every((bucket) => value.plannedBuckets?.includes(bucket)) ||
    value.pendingBuckets.some((bucket) => ownedBuckets.has(bucket)) ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("R2 broker receipt has invalid ownership fields");
  }
  return value as BrokerReceipt;
}

export async function createReceipt(
  receiptPath: string,
  receipt: BrokerReceipt,
): Promise<void> {
  await mkdir(path.dirname(receiptPath), { recursive: true });
  try {
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        "An unfinished R2 broker receipt already exists; recover it before starting another run",
      );
    }
    throw error;
  }
}

export async function replaceReceipt(
  receiptPath: string,
  receipt: BrokerReceipt,
): Promise<void> {
  const nextPath = `${receiptPath}.next`;
  await writeFile(nextPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(nextPath, receiptPath);
}

function isLockPublicationConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function publishReceiptLock(
  candidatePath: string,
  lockPath: string,
): Promise<boolean> {
  try {
    await link(candidatePath, lockPath);
    return true;
  } catch (error) {
    if (isLockPublicationConflict(error)) return false;
    throw error;
  }
}

export async function acquireReceiptLock(
  receiptPath: string,
): Promise<() => Promise<void>> {
  const lockPath = `${receiptPath}.lock`;
  await mkdir(path.dirname(receiptPath), { recursive: true });
  const owner = {
    hostname: hostname(),
    pid: process.pid,
    token: randomBytes(16).toString("hex"),
  };
  const candidatePath = `${lockPath}.candidate-${owner.token}`;
  await writeFile(candidatePath, `${JSON.stringify(owner)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await publishReceiptLock(candidatePath, lockPath)) {
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          await rm(lockPath);
        };
      }
      if (attempt > 0 || !(await reclaimStaleReceiptLock(lockPath, owner.hostname))) {
        throw new Error(
          "The R2 broker receipt is locked by another run; refusing concurrent recovery",
        );
      }
    }
    throw new Error("The R2 broker receipt lock could not be acquired");
  } finally {
    await rm(candidatePath, { force: true });
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

async function reclaimStaleReceiptLock(
  lockPath: string,
  currentHostname: string,
): Promise<boolean> {
  let owner: { hostname?: unknown; pid?: unknown; token?: unknown };
  try {
    const lock = await lstat(lockPath);
    if (!lock.isFile() && !lock.isDirectory()) return false;
    owner = JSON.parse(
      await readFile(
        lock.isDirectory() ? path.join(lockPath, "owner.json") : lockPath,
        "utf8",
      ),
    ) as { hostname?: unknown; pid?: unknown; token?: unknown };
  } catch {
    return false;
  }
  if (
    owner.hostname !== currentHostname ||
    typeof owner.pid !== "number" ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid < 1 ||
    typeof owner.token !== "string" ||
    !/^[a-f0-9]{32}$/.test(owner.token) ||
    processIsAlive(owner.pid)
  ) {
    return false;
  }
  const stalePath = `${lockPath}.stale-${owner.token}`;
  try {
    await rename(lockPath, stalePath);
  } catch {
    return false;
  }
  return true;
}

export async function removeReceipt(receiptPath: string): Promise<void> {
  const retiredPath = `${receiptPath}.retired`;
  await rename(receiptPath, retiredPath);
  await rm(retiredPath);
}
