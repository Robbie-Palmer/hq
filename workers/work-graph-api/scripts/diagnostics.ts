import { parseArgs } from "node:util";
import { diagnose, formatDiagnosticOutput } from "../src/diagnostics";

try {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      to: { type: "string" },
      monitor: { type: "boolean" },
    },
  });
  const end = values.to ? new Date(values.to) : new Date();
  const windowMinutes = values.monitor ? 30 : 15;
  const start = values.from
    ? new Date(values.from)
    : new Date(end.getTime() - windowMinutes * 60000);
  for (const value of [values.from, values.to]) {
    if (value && !/(Z|[+-]\d{2}:\d{2})$/.test(value))
      throw new Error("Use timestamps with timezones");
  }
  const result = await diagnose(
    {
      token: process.env.CLOUDFLARE_DIAGNOSTICS_API_TOKEN ?? "",
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      hyperdriveId: process.env.WORK_GRAPH_HYPERDRIVE_ID ?? "",
    },
    start,
    end,
  );
  console.log(formatDiagnosticOutput(result));
  process.exitCode = values.monitor && result.unhealthy ? 1 : 0;
} catch {
  console.error(
    "Diagnostic query failed. Check the dedicated token, network, IDs, timestamps, and API schema. No healthy result was recorded.",
  );
  process.exitCode = 2;
}
