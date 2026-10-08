#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DOPPLER_BOOTSTRAP_MARKER,
  dopplerSpawnExitCode,
  dopplerBootstrapArgs,
  resolveDopplerExecutable,
} from "./bootstrap.js";
import { runCli } from "./main.js";

const args = process.argv.slice(2);
const bootstrapArgs = dopplerBootstrapArgs(
  args,
  process.env,
  process.execPath,
  fileURLToPath(import.meta.url),
);

if (bootstrapArgs === undefined) {
  process.exitCode = await runCli(args);
} else {
  const dopplerExecutable = resolveDopplerExecutable(process.env, existsSync);
  const child =
    dopplerExecutable === undefined
      ? undefined
      : spawnSync(dopplerExecutable, bootstrapArgs, {
          env: { ...process.env, [DOPPLER_BOOTSTRAP_MARKER]: "1" },
          stdio: "inherit",
        });
  process.exitCode =
    child === undefined
      ? await runCli(args)
      : dopplerSpawnExitCode(child, (text) => process.stderr.write(text));
}
