import { defineConfig } from "@hey-api/openapi-ts";

export const workGraphOpenApiConfig = (output: string) =>
  defineConfig({
    input: "../../workers/work-graph-api/openapi.json",
    output: {
      clean: true,
      module: { extension: ".js" },
      path: output,
      tsConfigPath: "tsconfig.json",
    },
    plugins: [
      "@hey-api/client-fetch",
      "@hey-api/typescript",
      {
        name: "@hey-api/sdk",
        auth: false,
        client: false,
        operations: "flat",
        paramsStructure: "grouped",
        responseStyle: "fields",
      },
      {
        name: "zod",
        metadata: true,
        requests: true,
      },
    ],
  });

export default workGraphOpenApiConfig("src/generated/client");
