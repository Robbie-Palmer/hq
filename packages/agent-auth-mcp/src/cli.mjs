#!/usr/bin/env node

import { parseArguments } from "./options.mjs";
import { startMcpServer } from "./server.mjs";

try {
  await startMcpServer(parseArguments(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
