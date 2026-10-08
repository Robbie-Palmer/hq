import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileStorage } from "../src/storage.mjs";

const keypair = {
  publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "public" },
  privateKeyJwk: { kty: "OKP", crv: "Ed25519", d: "private" },
};

async function withStorageDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "agent-auth-mcp-storage-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("restricts the storage root and child directories", async () => {
  await withStorageDirectory(async (directory) => {
    new FileStorage(directory, "test-key");

    for (const current of [
      directory,
      join(directory, "agents"),
      join(directory, "providers"),
    ]) {
      assert.equal(statSync(current).mode & 0o777, 0o700);
    }
  });
});

test("round-trips encrypted identities and skips unreadable agent records", async () => {
  await withStorageDirectory(async (directory) => {
    const readableStorage = new FileStorage(directory, "current-key");
    await readableStorage.setHostIdentity({ hostId: "host", keypair });
    await readableStorage.setAgentConnection("readable", {
      agentId: "readable",
      agentKeypair: keypair,
      capabilityGrants: [],
    });

    const otherStorage = new FileStorage(directory, "other-key");
    await otherStorage.setAgentConnection("unreadable", {
      agentId: "unreadable",
      agentKeypair: keypair,
      capabilityGrants: [],
    });

    assert.deepEqual(await readableStorage.getHostIdentity(), {
      hostId: "host",
      keypair,
    });
    assert.deepEqual(
      (await readableStorage.listAgentConnections()).map(
        ({ agentId }) => agentId,
      ),
      ["readable"],
    );
  });
});

test("removes an unreadable host identity before fresh registration", async () => {
  await withStorageDirectory(async (directory) => {
    const originalStorage = new FileStorage(directory, "original-key");
    await originalStorage.setHostIdentity({ hostId: "host", keypair });

    const replacementStorage = new FileStorage(directory, "replacement-key");
    assert.equal(await replacementStorage.recoverUnreadableHostIdentity(), true);
    assert.equal(await replacementStorage.getHostIdentity(), null);
    assert.equal(await replacementStorage.recoverUnreadableHostIdentity(), false);
  });
});

test("removes the temporary file when an atomic rename fails", async () => {
  await withStorageDirectory(async (directory) => {
    const storage = new FileStorage(directory, "test-key");
    const destination = join(directory, "existing-directory");
    await mkdir(destination);

    assert.throws(() => storage.writeJson(destination, { secret: "value" }, true));
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.includes(".tmp")),
      [],
    );
  });
});
