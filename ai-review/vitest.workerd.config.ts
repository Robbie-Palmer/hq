import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { handleTestOutboundRequest } from "./tests-runtime/outbound-service.ts";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.toml" },
      miniflare: {
        outboundService: handleTestOutboundRequest,
      },
    }),
  ],
  test: {
    include: ["tests-runtime/**/*.test.ts"],
  },
});
