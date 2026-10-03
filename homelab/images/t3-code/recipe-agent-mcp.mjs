#!/usr/bin/env node

import { execFile } from "node:child_process";
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

import { reuseConnection } from "./recipe-agent-connections.mjs";
import { parseArguments } from "./recipe-agent-options.mjs";
import { FileStorage } from "./recipe-agent-storage.mjs";

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
        const reused = await reuseConnection(storage, client, args);
        if (reused) return reused;
        await storage.recoverUnreadableHostIdentity();
        return tool.execute(args, context);
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
  try {
    await startMcpServer(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
