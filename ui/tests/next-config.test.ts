import { afterEach, describe, expect, it, vi } from "vitest";

const codecovEnvironmentKeys = [
  "CODECOV_BUNDLE_ANALYSIS",
  "CODECOV_BUNDLE_DRY_RUN",
  "CODECOV_TOKEN",
  "CODECOV_USE_OIDC",
] as const;

type CodecovEnvironmentKey = (typeof codecovEnvironmentKeys)[number];

class NormalModuleReplacementPlugin {
  constructor(
    readonly resourceRegExp: RegExp,
    readonly replacement: string,
  ) {}
}

function setCodecovEnvironment(
  values: Partial<Record<CodecovEnvironmentKey, string>>,
): void {
  for (const key of codecovEnvironmentKeys) {
    delete process.env[key];
  }
  Object.assign(process.env, values);
}

async function loadNextConfig(
  values: Partial<Record<CodecovEnvironmentKey, string>>,
) {
  setCodecovEnvironment(values);
  vi.resetModules();
  const codecovPlugin = vi.fn((_options: unknown) => ({ apply: vi.fn() }));
  vi.doMock("@codecov/nextjs-webpack-plugin", () => ({
    codecovNextJSWebpackPlugin: codecovPlugin,
  }));
  const { default: createNextConfig } = await import("../next.config");
  return {
    createNextConfig,
    codecovPlugin,
  };
}

function runWebpack(
  createNextConfig: Awaited<
    ReturnType<typeof loadNextConfig>
  >["createNextConfig"],
) {
  const nextConfig = createNextConfig("phase-production-build");
  const webpackConfig: {
    experiments?: Record<string, unknown>;
    plugins?: unknown[];
    resolve?: { fallback?: Record<string, unknown> };
  } = {};

  nextConfig.webpack?.(
    webpackConfig as never,
    {
      isServer: false,
      webpack: { NormalModuleReplacementPlugin },
    } as never,
  );
  return webpackConfig;
}

afterEach(() => {
  setCodecovEnvironment({});
  vi.clearAllMocks();
});

describe("Next.js Codecov bundle analysis", () => {
  it("leaves bundle analysis disabled by default", async () => {
    const { createNextConfig, codecovPlugin } = await loadNextConfig({});

    const webpackConfig = runWebpack(createNextConfig);

    expect(codecovPlugin).not.toHaveBeenCalled();
    expect(webpackConfig.plugins).toHaveLength(1);
  });

  it("uses GitHub OIDC for trusted bundle uploads", async () => {
    const { createNextConfig, codecovPlugin } = await loadNextConfig({
      CODECOV_BUNDLE_ANALYSIS: "true",
      CODECOV_BUNDLE_DRY_RUN: "true",
      CODECOV_USE_OIDC: "true",
    });

    runWebpack(createNextConfig);

    expect(codecovPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleName: "personal-site-ui",
        dryRun: true,
        enableBundleAnalysis: true,
        gitService: "github",
        oidc: { useGitHubOIDC: true },
      }),
    );
    expect(codecovPlugin.mock.calls[0]?.[0]).not.toHaveProperty("uploadToken");
  });

  it("uses the upload token when OIDC is disabled", async () => {
    const { createNextConfig, codecovPlugin } = await loadNextConfig({
      CODECOV_BUNDLE_ANALYSIS: "true",
      CODECOV_TOKEN: "test-upload-token",
    });

    runWebpack(createNextConfig);

    expect(codecovPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        uploadToken: "test-upload-token",
      }),
    );
    expect(codecovPlugin.mock.calls[0]?.[0]).not.toHaveProperty("oidc");
  });
});
