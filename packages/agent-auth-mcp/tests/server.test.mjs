import assert from "node:assert/strict";
import test from "node:test";

import {
  createClient,
  propertyToZod,
  schemaToZod,
  startMcpServer,
} from "../src/server.mjs";

test("creates an Agent Auth client with portable approval callbacks", () => {
  let options;
  class Client {
    constructor(value) {
      options = value;
    }
  }
  const opened = [];
  const messages = [];
  const originalError = console.error;
  console.error = (message) => messages.push(message);
  try {
    createClient(
      { name: "storage" },
      {
        urls: ["https://provider.example"],
        directoryUrl: "https://directory.example",
        hostName: "Test host",
        noBrowser: false,
      },
      Client,
      (url) => opened.push(url),
    );

    assert.equal(options.directoryUrl, undefined);
    assert.equal(options.hostName, "Test host");
    assert.deepEqual(options.storage, { name: "storage" });
    options.onApprovalRequired({ method: "device" });
    options.onApprovalRequired({
      verification_uri: "https://provider.example/approve",
      user_code: "CODE",
    });
    options.onApprovalStatusChange("approved");
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(opened, ["https://provider.example/approve"]);
  assert.deepEqual(messages, [
    "Approval required (method: device). Waiting…",
    "Approval required — opening browser…",
    "Code: CODE",
    "Status: approved",
  ]);
});

test("prints approval URLs when browser opening is disabled", () => {
  let options;
  class Client {
    constructor(value) {
      options = value;
    }
  }
  const messages = [];
  const originalError = console.error;
  console.error = (message) => messages.push(message);
  try {
    createClient(
      {},
      {
        directoryUrl: "https://directory.example",
        noBrowser: true,
      },
      Client,
    );
    options.onApprovalRequired({
      verification_uri_complete: "https://provider.example/approve?code=CODE",
    });
  } finally {
    console.error = originalError;
  }

  assert.equal(options.directoryUrl, "https://directory.example");
  assert.deepEqual(messages, [
    "Approval required. Open: https://provider.example/approve?code=CODE",
  ]);
});

test("converts Agent Auth JSON schemas to MCP Zod schemas", () => {
  const shape = schemaToZod({
    required: ["text", "nested"],
    properties: {
      text: { type: "string", description: "Text value" },
      count: { type: "number" },
      enabled: { type: "boolean" },
      choice: { enum: ["one", "two"] },
      list: { type: "array", items: { type: "string" } },
      unionList: {
        type: "array",
        items: { oneOf: [{ type: "string" }, { type: "number" }] },
      },
      nested: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" }, note: { type: "string" } },
      },
      record: { type: "object" },
      union: { oneOf: [{ type: "string" }, { type: "boolean" }] },
      anything: {},
    },
  });

  assert.equal(shape.text.description, "Text value");
  assert.equal(shape.text.parse("value"), "value");
  assert.equal(shape.count.parse(2), 2);
  assert.equal(shape.enabled.parse(true), true);
  assert.equal(shape.choice.parse("two"), "two");
  assert.deepEqual(shape.list.parse(["one"]), ["one"]);
  assert.deepEqual(shape.unionList.parse(["one", 2]), ["one", 2]);
  assert.deepEqual(shape.nested.parse({ id: "id" }), { id: "id" });
  assert.deepEqual(shape.record.parse({ id: 1 }), { id: 1 });
  assert.equal(shape.union.parse(false), false);
  assert.deepEqual(shape.anything.parse({ any: "value" }), { any: "value" });
  assert.equal(shape.count.parse(undefined), undefined);
  assert.equal(schemaToZod({ properties: {} }), undefined);
  assert.equal(propertyToZod({ type: "array", items: {} }).parse([1])[0], 1);
});

test("registers tools, reuses connections, and cleans up the client", async () => {
  const registrations = new Map();
  const signalListeners = new Map();
  let storage;
  class Storage {
    constructor(directory) {
      assert.equal(directory, "/tmp/agent-auth");
      storage = this;
    }
    connections = [
      {
        agentId: "existing",
        hostId: "host",
        issuer: "https://provider.example",
        mode: "delegated",
        createdAt: 1,
        capabilityGrants: [
          { capability: "records.read", status: "active" },
        ],
      },
    ];
    recovered = 0;
    async listAgentConnections() {
      return this.connections;
    }
    async recoverUnreadableHostIdentity() {
      this.recovered += 1;
    }
  }
  const client = {
    destroyed: 0,
    initialized: 0,
    isUrlMode: true,
    async init() {
      this.initialized += 1;
    },
    async destroy() {
      this.destroyed += 1;
    },
    async getProviderConfig() {
      return { issuer: "https://provider.example" };
    },
  };
  let fallbackCalls = 0;
  const tools = [
    {
      name: "connect_agent",
      description: "Connect",
      parameters: {
        required: ["provider"],
        properties: { provider: { type: "string" } },
      },
      async execute() {
        fallbackCalls += 1;
        return { status: "pending" };
      },
    },
    {
      name: "disconnect_agent",
      description: "Disconnect",
      parameters: { properties: {} },
      async execute(args, context) {
        return { args, aborted: context.signal.aborted };
      },
    },
    {
      name: "search_providers",
      description: "Search",
      parameters: { properties: {} },
      async execute() {
        return {};
      },
    },
  ];
  class Server {
    constructor(identity, options) {
      assert.deepEqual(identity, { name: "agent-auth-mcp", version: "0.1.0" });
      assert.equal(typeof options.instructions, "string");
      this.server = {};
    }
    registerTool(name, options, execute) {
      registrations.set(name, { execute, options });
    }
    async connect(transport) {
      assert.equal(transport.kind, "stdio");
    }
  }
  class Transport {
    kind = "stdio";
  }

  const result = await startMcpServer(
    { storageDir: "/tmp/agent-auth" },
    {
      Storage,
      createAgentClient() {
        return client;
      },
      getTools() {
        return tools;
      },
      filter(values, options) {
        assert.deepEqual(options, { exclude: ["search_providers"] });
        return values.filter(({ name }) => name !== "search_providers");
      },
      Server,
      Transport,
      addSignalListener(signal, listener) {
        signalListeners.set(signal, listener);
      },
    },
  );

  assert.equal(result.client, client);
  assert.equal(result.storage, storage);
  assert.equal(client.initialized, 1);
  assert.deepEqual([...registrations.keys()], [
    "connect_agent",
    "disconnect_agent",
  ]);
  assert.match(
    registrations.get("connect_agent").options.description,
    /^Reuse the newest matching active connection/,
  );
  assert.equal(
    registrations.get("connect_agent").options.inputSchema.provider.parse(
      "Example provider",
    ),
    "Example provider",
  );
  assert.equal(
    registrations.get("disconnect_agent").options.inputSchema,
    undefined,
  );

  const reused = await registrations.get("connect_agent").execute(
    {
      provider: "Example provider",
      mode: "delegated",
      capabilities: ["records.read"],
    },
    {},
  );
  assert.equal(JSON.parse(reused.content[0].text).reused, true);
  assert.equal(fallbackCalls, 0);

  storage.connections = [];
  const fallback = await registrations.get("connect_agent").execute(
    { provider: "Example provider" },
    {},
  );
  assert.equal(JSON.parse(fallback.content[0].text).status, "pending");
  assert.equal(storage.recovered, 1);
  assert.equal(fallbackCalls, 1);

  const controller = new AbortController();
  const disconnected = await registrations.get("disconnect_agent").execute(
    { agentId: "existing" },
    { signal: controller.signal },
  );
  assert.deepEqual(JSON.parse(disconnected.content[0].text), {
    args: { agentId: "existing" },
    aborted: false,
  });

  assert.deepEqual([...signalListeners.keys()], ["SIGINT", "SIGTERM", "SIGHUP"]);
  await signalListeners.get("SIGTERM")();
  await result.server.server.onclose();
  assert.equal(client.destroyed, 2);
});
