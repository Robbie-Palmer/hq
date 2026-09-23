import { describe, expect, it } from "vitest";
import { resolveClientConfig } from "../src/config.js";
import { CliError } from "../src/errors.js";

const resolve = (environment: NodeJS.ProcessEnv) =>
  resolveClientConfig({ accessAllowedOrigins: [] }, environment);

describe("Given Work Graph CLI configuration", () => {
  it("accepts HTTPS and loopback HTTP API URLs", () => {
    expect(resolve({ WORK_GRAPH_API_URL: "https://work.example.test" }).apiUrl.href).toBe(
      "https://work.example.test/",
    );
    expect(resolve({ WORK_GRAPH_API_URL: "http://127.0.0.1:8787" }).apiUrl.href).toBe(
      "http://127.0.0.1:8787/",
    );
  });

  it.each([
    "http://work.example.test",
    "ftp://work.example.test",
    "https://user:password@work.example.test",
    "https://work.example.test?target=other",
    "not a URL",
  ])("rejects unsafe API URL %s", (apiUrl) => {
    expect(() => resolve({ WORK_GRAPH_API_URL: apiUrl })).toThrow(CliError);
  });

  it("requires both Access credential values", () => {
    expect(() =>
      resolve({
        WORK_GRAPH_API_URL: "https://work.example.test",
        CF_ACCESS_CLIENT_ID: "client-id",
      }),
    ).toThrow("must be set together");
  });

  it("requires both Work Graph-specific Access credential values", () => {
    expect(() =>
      resolve({
        WORK_GRAPH_API_URL: "https://work.example.test",
        WORK_GRAPH_CF_ACCESS_CLIENT_ID: "client-id",
      }),
    ).toThrow("WORK_GRAPH_CF_ACCESS_CLIENT_ID and WORK_GRAPH_CF_ACCESS_CLIENT_SECRET");
  });

  it("prefers Work Graph-specific Access credentials over shared credentials", () => {
    expect(
      resolve({
        WORK_GRAPH_API_URL: "https://work.example.test",
        WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS: "https://work.example.test",
        WORK_GRAPH_CF_ACCESS_CLIENT_ID: "work-graph-id",
        WORK_GRAPH_CF_ACCESS_CLIENT_SECRET: "work-graph-secret",
        CF_ACCESS_CLIENT_ID: "preview-id",
      }).accessHeaders,
    ).toEqual({
      "CF-Access-Client-Id": "work-graph-id",
      "CF-Access-Client-Secret": "work-graph-secret",
    });
  });

  it("requires trusted entries to be origins rather than path prefixes", () => {
    expect(() =>
      resolve({
        WORK_GRAPH_API_URL: "https://work.example.test",
        CF_ACCESS_CLIENT_ID: "client-id",
        CF_ACCESS_CLIENT_SECRET: "client-secret",
        WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS:
          "https://work.example.test/suspicious-path",
      }),
    ).toThrow("must contain only a URL origin");
  });
});
