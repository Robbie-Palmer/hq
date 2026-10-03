#!/usr/bin/env node

import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
  AgentAuthClient,
  filterTools,
  getAgentAuthTools,
  SERVER_INSTRUCTIONS,
} from "@auth/agent";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { selectReusableConnection } from "./recipe-agent-connections.mjs";

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), ".agent-auth");
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(data, secret) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    deriveKey(secret),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );
  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

function decrypt(encoded, secret) {
  const buffer = Buffer.from(encoded, "base64url");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    deriveKey(secret),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export class FileStorage {
  constructor(directory, encryptionKey) {
    this.directory = directory ?? DEFAULT_STORAGE_DIR;
    this.encryptionKey =
      encryptionKey ?? process.env.AGENT_AUTH_ENCRYPTION_KEY ?? null;
    for (const child of ["agents", "providers"]) {
      fs.mkdirSync(path.join(this.directory, child), { recursive: true });
    }
    if (!this.encryptionKey) {
      process.stderr.write(
        "[agent-auth] WARNING: Private keys will be stored unencrypted. " +
          "Set AGENT_AUTH_ENCRYPTION_KEY.\n",
      );
    }
  }

  encode(value) {
    return encodeURIComponent(value).replaceAll("%", "_");
  }

  readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  writeJson(filePath, data, secret = false) {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: secret ? 0o600 : undefined,
    });
    fs.renameSync(temporaryPath, filePath);
  }

  deleteFile(filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Deleting an already absent connection is idempotent.
    }
  }

  listJson(directory) {
    try {
      return fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
  }

  encryptKeypair(keypair) {
    if (!this.encryptionKey) return keypair;
    return {
      __encrypted: encrypt(JSON.stringify(keypair), this.encryptionKey),
    };
  }

  decryptKeypair(stored) {
    if (stored && typeof stored === "object" && "__encrypted" in stored) {
      if (!this.encryptionKey) {
        throw new Error(
          "Private key is encrypted but AGENT_AUTH_ENCRYPTION_KEY is not set.",
        );
      }
      return JSON.parse(decrypt(stored.__encrypted, this.encryptionKey));
    }
    return stored;
  }

  get hostPath() {
    return path.join(this.directory, "host.json");
  }

  async getHostIdentity() {
    const stored = this.readJson(this.hostPath);
    return stored
      ? { ...stored, keypair: this.decryptKeypair(stored.keypair) }
      : null;
  }

  async setHostIdentity(host) {
    this.writeJson(
      this.hostPath,
      { ...host, keypair: this.encryptKeypair(host.keypair) },
      true,
    );
  }

  async deleteHostIdentity() {
    this.deleteFile(this.hostPath);
  }

  agentPath(agentId) {
    return path.join(this.directory, "agents", `${this.encode(agentId)}.json`);
  }

  async getAgentConnection(agentId) {
    const stored = this.readJson(this.agentPath(agentId));
    return stored
      ? {
          ...stored,
          agentKeypair: this.decryptKeypair(stored.agentKeypair),
        }
      : null;
  }

  async setAgentConnection(agentId, connection) {
    this.writeJson(
      this.agentPath(agentId),
      {
        ...connection,
        agentKeypair: this.encryptKeypair(connection.agentKeypair),
      },
      true,
    );
  }

  async deleteAgentConnection(agentId) {
    this.deleteFile(this.agentPath(agentId));
  }

  async listAgentConnections() {
    const directory = path.join(this.directory, "agents");
    return this.listJson(directory)
      .map((name) => this.readJson(path.join(directory, name)))
      .filter(Boolean)
      .map((stored) => ({
        ...stored,
        agentKeypair: this.decryptKeypair(stored.agentKeypair),
      }));
  }

  providerPath(issuer) {
    return path.join(
      this.directory,
      "providers",
      `${this.encode(issuer)}.json`,
    );
  }

  async getProviderConfig(issuer) {
    return this.readJson(this.providerPath(issuer));
  }

  async setProviderConfig(issuer, config) {
    this.writeJson(this.providerPath(issuer), config);
  }

  async listProviderConfigs() {
    const directory = path.join(this.directory, "providers");
    return this.listJson(directory)
      .map((name) => this.readJson(path.join(directory, name)))
      .filter(Boolean);
  }
}

export async function reuseConnection(storage, client, args) {
  if (args.force_approval) return null;
  const provider = await client.getProviderConfig(args.provider);
  const connection = selectReusableConnection(
    await storage.listAgentConnections(),
    {
      issuer: provider.issuer,
      mode: args.mode,
      capabilities: args.capabilities,
    },
  );
  if (!connection) return null;
  return {
    agentId: connection.agentId,
    hostId: connection.hostId,
    status: "active",
    capabilityGrants: connection.capabilityGrants,
    reused: true,
  };
}

function parseArguments(argv) {
  const config = {
    storageDir: process.env.AGENT_AUTH_STORAGE_DIR,
    directoryUrl: process.env.AGENT_AUTH_DIRECTORY_URL,
    hostName: process.env.AGENT_AUTH_HOST_NAME,
    noBrowser: process.env.AGENT_AUTH_NO_BROWSER === "1",
    urls: [],
  };
  const valueFlags = new Map([
    ["--storage-dir", "storageDir"],
    ["--directory-url", "directoryUrl"],
    ["--host-name", "hostName"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "mcp") continue;
    if (argument === "--no-browser") {
      config.noBrowser = true;
      continue;
    }
    if (argument === "--url") {
      while (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        index += 1;
        config.urls.push(argv[index]);
      }
      continue;
    }
    const key = valueFlags.get(argument);
    if (key && argv[index + 1]) {
      index += 1;
      config[key] = argv[index];
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  if (config.urls.length === 0) delete config.urls;
  return config;
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, () => {});
}

function createClient(storage, config) {
  return new AgentAuthClient({
    storage,
    urls: config.urls,
    directoryUrl:
      config.urls?.length > 0 ? undefined : config.directoryUrl,
    hostName: config.hostName,
    onApprovalRequired(info) {
      const url = info.verification_uri_complete ?? info.verification_uri;
      if (!url) {
        console.error(`Approval required (method: ${info.method}). Waiting…`);
        return;
      }
      if (config.noBrowser) {
        console.error(`Approval required. Open: ${url}`);
      } else {
        console.error("Approval required — opening browser…");
        openBrowser(url);
      }
      if (info.user_code) console.error(`Code: ${info.user_code}`);
    },
    onApprovalStatusChange(status) {
      console.error(`Status: ${status}`);
    },
  });
}

function propertyToZod(property) {
  if (property.oneOf?.length >= 2) {
    const [first, second, ...rest] = property.oneOf.map(propertyToZod);
    return z.union([first, second, ...rest]);
  }
  if (property.type === "array") {
    if (property.items?.oneOf) return z.array(propertyToZod(property.items));
    return z.array(property.items?.type === "string" ? z.string() : z.unknown());
  }
  if (property.enum) return z.enum(property.enum);
  if (property.type === "object" && property.properties) {
    const required = new Set(property.required ?? []);
    return z.object(
      Object.fromEntries(
        Object.entries(property.properties).map(([name, child]) => {
          let schema = propertyToZod(child);
          if (child.description) schema = schema.describe(child.description);
          return [name, required.has(name) ? schema : schema.optional()];
        }),
      ),
    );
  }
  if (property.type === "string") return z.string();
  if (property.type === "number") return z.number();
  if (property.type === "boolean") return z.boolean();
  if (property.type === "object") return z.record(z.string(), z.unknown());
  return z.unknown();
}

function schemaToZod(parameters) {
  if (Object.keys(parameters.properties).length === 0) return undefined;
  const required = new Set(parameters.required ?? []);
  return Object.fromEntries(
    Object.entries(parameters.properties).map(([name, property]) => {
      let schema = propertyToZod(property);
      if (property.description) schema = schema.describe(property.description);
      return [name, required.has(name) ? schema : schema.optional()];
    }),
  );
}

export async function startMcpServer(config) {
  const storage = new FileStorage(config.storageDir);
  const client = createClient(storage, config);
  await client.init();
  let tools = getAgentAuthTools(client);
  if (client.isUrlMode) {
    tools = filterTools(tools, { exclude: ["search_providers"] });
  }
  tools = tools.map((tool) => {
    if (tool.name !== "connect_agent") return tool;
    return {
      ...tool,
      description:
        "Reuse the newest matching active connection from shared storage, " +
        "or connect to the provider if none exists. " +
        tool.description,
      async execute(args, context) {
        return (
          (await reuseConnection(storage, client, args)) ??
          tool.execute(args, context)
        );
      },
    };
  });

  const server = new McpServer(
    { name: "recipe-agent", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const tool of tools) {
    const options = { description: tool.description };
    const inputSchema = schemaToZod(tool.parameters);
    if (inputSchema) options.inputSchema = inputSchema;
    server.registerTool(tool.name, options, async (args, extra) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await tool.execute(args, { signal: extra?.signal }),
            null,
            2,
          ),
        },
      ],
    }));
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const cleanup = () => client.destroy();
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
  server.server.onclose = cleanup;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  startMcpServer(parseArguments(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
