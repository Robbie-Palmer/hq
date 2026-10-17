import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.toml" },
      miniflare: {
        outboundService(request) {
          const url = new URL(request.url);
          if (
            request.method === "POST" &&
            url.pathname === "/app/installations/456/access_tokens"
          ) {
            return Response.json({
              token: "installation-token",
              expires_at: "2099-01-01T00:00:00Z",
              permissions: {},
              repository_selection: "all",
            });
          }
          if (url.pathname === "/repos/acme/widgets") {
            return Response.json({ id: 1, full_name: "acme/widgets" });
          }
          if (url.pathname === "/retry-test") {
            return new Response("ok");
          }
          return new Response("Not found", { status: 404 });
        },
      },
    }),
  ],
  test: {
    include: ["tests-runtime/**/*.test.ts"],
  },
});
