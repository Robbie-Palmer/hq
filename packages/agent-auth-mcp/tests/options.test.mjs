import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../src/options.mjs";

test("parses repeatable URL flags and validates the result", () => {
  assert.deepEqual(
    parseArguments(
      [
        "mcp",
        "--storage-dir",
        "/tmp/agent-auth",
        "--host-name",
        "Codex",
        "--url",
        "https://one.example",
        "--url",
        "https://two.example",
        "--no-browser",
      ],
      {},
    ),
    {
      storageDir: "/tmp/agent-auth",
      directoryUrl: undefined,
      hostName: "Codex",
      noBrowser: true,
      urls: ["https://one.example", "https://two.example"],
    },
  );
});

test("uses validated Agent Auth environment defaults", () => {
  assert.deepEqual(
    parseArguments([], {
      AGENT_AUTH_DIRECTORY_URL: "https://directory.example",
      AGENT_AUTH_HOST_NAME: "Codex",
      AGENT_AUTH_NO_BROWSER: "1",
      AGENT_AUTH_STORAGE_DIR: "/tmp/agent-auth",
      AGENT_AUTH_URLS: "https://one.example, https://two.example",
    }),
    {
      storageDir: "/tmp/agent-auth",
      directoryUrl: "https://directory.example",
      hostName: "Codex",
      noBrowser: true,
      urls: ["https://one.example", "https://two.example"],
    },
  );
});

test("rejects unknown flags, extra commands, and invalid URLs", () => {
  assert.throws(
    () => parseArguments(["--unknown"], {}),
    /Unknown option '--unknown'/,
  );
  assert.throws(
    () => parseArguments(["serve"], {}),
    /Invalid agent-auth-mcp command/,
  );
  assert.throws(
    () => parseArguments(["--url", "not-a-url"], {}),
    /Invalid agent-auth-mcp arguments/,
  );
});
