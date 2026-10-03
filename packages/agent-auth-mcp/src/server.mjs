import { execFile } from "node:child_process";

import {
  AgentAuthClient,
  filterTools,
  getAgentAuthTools,
  SERVER_INSTRUCTIONS,
} from "@auth/agent";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import packageManifest from "../package.json" with { type: "json" };
import { reuseConnection } from "./connections.mjs";
import { FileStorage } from "./storage.mjs";

function openBrowser(url) {
  let command = "xdg-open";
  let args = [url];
  if (process.platform === "darwin") {
    command = "open";
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  }
  execFile(command, args, () => {});
}

export function createClient(
  storage,
  config,
  Client = AgentAuthClient,
  openUrl = openBrowser,
) {
  return new Client({
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
        openUrl(url);
      }
      if (info.user_code) console.error(`Code: ${info.user_code}`);
    },
    onApprovalStatusChange(status) {
      console.error(`Status: ${status}`);
    },
  });
}

export function propertyToZod(property) {
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

export function schemaToZod(parameters) {
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

export async function startMcpServer(config, dependencies = {}) {
  const {
    Storage = FileStorage,
    createAgentClient = createClient,
    getTools = getAgentAuthTools,
    filter = filterTools,
    Server = McpServer,
    Transport = StdioServerTransport,
    addSignalListener = process.on.bind(process),
  } = dependencies;
  const storage = new Storage(config.storageDir);
  const client = createAgentClient(storage, config);
  await client.init();
  let tools = getTools(client);
  if (client.isUrlMode) {
    tools = filter(tools, { exclude: ["search_providers"] });
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
        const reused = await reuseConnection(storage, client, args);
        if (reused) return reused;
        await storage.recoverUnreadableHostIdentity();
        return tool.execute(args, context);
      },
    };
  });

  const server = new Server(
    { name: packageManifest.name, version: packageManifest.version },
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

  const transport = new Transport();
  await server.connect(transport);
  const cleanup = () => client.destroy();
  addSignalListener("SIGINT", cleanup);
  addSignalListener("SIGTERM", cleanup);
  addSignalListener("SIGHUP", cleanup);
  server.server.onclose = cleanup;
  return { client, server, storage };
}
