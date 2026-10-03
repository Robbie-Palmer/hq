import { parseArgs } from "node:util";

import { z } from "zod";

const optionalText = z.string().min(1).optional();
const optionalUrl = z.string().url().optional();
const configurationSchema = z.object({
  storageDir: optionalText,
  directoryUrl: optionalUrl,
  hostName: optionalText,
  noBrowser: z.boolean(),
  urls: z.array(z.string().url()).min(1).optional(),
});
const positionalSchema = z.union([
  z.tuple([]),
  z.tuple([z.literal("mcp")]),
]);

function formatZodError(error) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
    .join("; ");
}

export function parseArguments(argv, environment = process.env) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "storage-dir": { type: "string" },
      "directory-url": { type: "string" },
      "host-name": { type: "string" },
      "no-browser": { type: "boolean" },
      url: { type: "string", multiple: true },
    },
  });
  const parsedPositionals = positionalSchema.safeParse(positionals);
  if (!parsedPositionals.success) {
    throw new Error(
      `Invalid recipe-agent command: ${formatZodError(parsedPositionals.error)}`,
    );
  }

  const environmentUrls = environment.AGENT_AUTH_URLS?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const parsedConfig = configurationSchema.safeParse({
    storageDir: values["storage-dir"] ?? environment.AGENT_AUTH_STORAGE_DIR,
    directoryUrl:
      values["directory-url"] ?? environment.AGENT_AUTH_DIRECTORY_URL,
    hostName: values["host-name"] ?? environment.AGENT_AUTH_HOST_NAME,
    noBrowser:
      values["no-browser"] ?? environment.AGENT_AUTH_NO_BROWSER === "1",
    urls:
      values.url ?? (environmentUrls?.length ? environmentUrls : undefined),
  });
  if (!parsedConfig.success) {
    throw new Error(
      `Invalid recipe-agent arguments: ${formatZodError(parsedConfig.error)}`,
    );
  }
  return parsedConfig.data;
}
