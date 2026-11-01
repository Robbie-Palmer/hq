import { readFile } from "node:fs/promises";
import {
  ErrorCode,
  OpenFeature as ServerOpenFeature,
  type EvaluationContext as ServerEvaluationContext,
} from "@openfeature/server-sdk";
import { OpenFeature as WebOpenFeature } from "@openfeature/web-sdk";
import { PostHogServerProvider } from "@posthog/openfeature-node-provider";
import { PostHogWebProvider } from "@posthog/openfeature-web-provider";
import type { PostHog as PostHogWebClient } from "posthog-js";
import type { PostHog as PostHogNodeClient } from "posthog-node";
import { describe, expect, it, vi } from "vitest";
import workerFixture from "../fixtures/cloudflare-worker";

type JsonObject = Record<string, string>;

type FixtureResult = {
  enabled: boolean;
  variant: string | null;
  payload: unknown;
  reason: string;
};

type EvaluationFixture = {
  key: string;
  type: "boolean" | "string" | "number" | "object";
  default: unknown;
  result: FixtureResult;
  expected: {
    value: unknown;
    variant?: string;
    reason: string;
  };
};

type ContractFixture = {
  context: {
    targetingKey: string;
    personProperties: JsonObject;
    groups: Record<string, string>;
    groupProperties: Record<string, JsonObject>;
  };
  evaluations: EvaluationFixture[];
  safeDefaults: Array<{
    state: "not-ready" | "ready" | "stale" | "error";
    critical: boolean;
    cached?: boolean;
    default: boolean;
    expected: boolean;
  }>;
};

const fixturePath = new URL(
  "../../../ui/content/projects/personal-engineering-platform/feature-flag-conformance/evaluations.json",
  import.meta.url,
);

async function loadFixture(): Promise<ContractFixture> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as ContractFixture;
}

function resultFor(fixture: EvaluationFixture): {
  key: string;
  enabled: boolean;
  variant: string | undefined;
  payload: unknown;
  reason: string;
} {
  return {
    key: fixture.key,
    enabled: fixture.result.enabled,
    variant: fixture.result.variant ?? undefined,
    payload: fixture.result.payload ?? undefined,
    reason: fixture.result.reason,
  };
}

class FakeNodePostHog {
  readonly exposures: Array<{
    event: "$feature_flag_called";
    key: string;
    response: boolean | string;
  }> = [];
  readonly getFeatureFlagResult = vi.fn(
    async (
      key: string,
      _distinctId: string,
      options?: { sendFeatureFlagEvents?: boolean },
    ) => {
      if (this.failure) throw this.failure;
      const fixture = this.evaluations.get(key);
      if (!fixture) return undefined;
      if (options?.sendFeatureFlagEvents !== false) {
        this.exposures.push({
          event: "$feature_flag_called",
          key,
          response: fixture.result.variant ?? fixture.result.enabled,
        });
      }
      return resultFor(fixture);
    },
  );
  readonly reloadFeatureFlags = vi.fn(async () => undefined);

  constructor(
    readonly evaluations: Map<string, EvaluationFixture>,
    readonly failure?: Error,
  ) {}

  on(): () => void {
    return () => undefined;
  }
}

class FakeWebPostHog {
  readonly exposures: FakeNodePostHog["exposures"] = [];
  readonly personProperties: JsonObject[] = [];
  readonly groups: Array<{
    type: string;
    key: string;
    properties: JsonObject | undefined;
  }> = [];
  private featureFlagCallback: (() => void) | undefined;

  constructor(readonly evaluations: Map<string, EvaluationFixture>) {}

  getFeatureFlagResult(
    key: string,
    options?: { send_event?: boolean },
  ): ReturnType<typeof resultFor> | undefined {
    const fixture = this.evaluations.get(key);
    if (!fixture) return undefined;
    if (options?.send_event !== false) {
      this.exposures.push({
        event: "$feature_flag_called",
        key,
        response: fixture.result.variant ?? fixture.result.enabled,
      });
    }
    return resultFor(fixture);
  }

  setPersonPropertiesForFlags(properties: JsonObject): void {
    this.personProperties.push(properties);
  }

  group(type: string, key: string, properties?: JsonObject): void {
    this.groups.push({ type, key, properties });
  }

  onFeatureFlags(callback: () => void): () => void {
    this.featureFlagCallback = callback;
    return () => {
      this.featureFlagCallback = undefined;
    };
  }

  reloadFeatureFlags(): void {
    queueMicrotask(() => this.featureFlagCallback?.());
  }
}

function serverContext(fixture: ContractFixture): ServerEvaluationContext {
  return {
    targetingKey: fixture.context.targetingKey,
    ...fixture.context.personProperties,
    groups: fixture.context.groups,
    groupProperties: fixture.context.groupProperties,
  };
}

async function resolveNodeFixture(
  provider: PostHogServerProvider,
  evaluation: EvaluationFixture,
  context: ServerEvaluationContext,
): Promise<{ value: unknown; variant?: string; reason?: string }> {
  switch (evaluation.type) {
    case "boolean":
      return provider.resolveBooleanEvaluation(
        evaluation.key,
        evaluation.default as boolean,
        context,
      );
    case "string":
      return provider.resolveStringEvaluation(
        evaluation.key,
        evaluation.default as string,
        context,
      );
    case "number":
      return provider.resolveNumberEvaluation(
        evaluation.key,
        evaluation.default as number,
        context,
      );
    case "object":
      return provider.resolveObjectEvaluation(
        evaluation.key,
        evaluation.default as JsonObject,
        context,
      );
  }
}

function resolveWebFixture(
  provider: PostHogWebProvider,
  evaluation: EvaluationFixture,
): { value: unknown; variant?: string; reason?: string } {
  switch (evaluation.type) {
    case "boolean":
      return provider.resolveBooleanEvaluation(
        evaluation.key,
        evaluation.default as boolean,
      );
    case "string":
      return provider.resolveStringEvaluation(
        evaluation.key,
        evaluation.default as string,
      );
    case "number":
      return provider.resolveNumberEvaluation(
        evaluation.key,
        evaluation.default as number,
      );
    case "object":
      return provider.resolveObjectEvaluation(
        evaluation.key,
        evaluation.default as JsonObject,
      );
  }
}

describe("official PostHog OpenFeature providers", () => {
  it("keeps the Cloudflare build fixture disabled and inspectable", async () => {
    const response = workerFixture.fetch();

    await expect(response.json()).resolves.toEqual({
      provider: "PostHogServerProvider",
      sdk: "posthog-node",
    });
  });

  it("resolves the shared typed fixtures through the Node provider", async () => {
    const fixture = await loadFixture();
    const evaluations = new Map(
      fixture.evaluations.map((evaluation) => [evaluation.key, evaluation]),
    );
    const posthog = new FakeNodePostHog(evaluations);
    const provider = new PostHogServerProvider(
      posthog as unknown as PostHogNodeClient,
      { sendFeatureFlagEvents: true },
    );

    await provider.initialize?.();
    for (const evaluation of fixture.evaluations) {
      const details = await resolveNodeFixture(
        provider,
        evaluation,
        serverContext(fixture),
      );
      expect(details).toMatchObject(evaluation.expected);
    }

    expect(posthog.reloadFeatureFlags).toHaveBeenCalledOnce();
    expect(posthog.getFeatureFlagResult).toHaveBeenCalledTimes(
      fixture.evaluations.length,
    );
    expect(posthog.exposures).toHaveLength(fixture.evaluations.length);
    expect(posthog.exposures).toContainEqual({
      event: "$feature_flag_called",
      key: "checkout-experiment",
      response: "test",
    });
  });

  it("maps browser context without treating targetingKey as browser identity", async () => {
    const fixture = await loadFixture();
    const posthog = new FakeWebPostHog(
      new Map(
        fixture.evaluations.map((evaluation) => [evaluation.key, evaluation]),
      ),
    );
    const provider = new PostHogWebProvider(
      posthog as unknown as PostHogWebClient,
      { sendFeatureFlagEvents: true, reloadTimeoutMs: 100 },
    );

    await provider.initialize({
      targetingKey: "ignored-browser-target",
      ...fixture.context.personProperties,
      groups: fixture.context.groups,
      groupProperties: fixture.context.groupProperties,
    });
    for (const evaluation of fixture.evaluations) {
      expect(resolveWebFixture(provider, evaluation)).toMatchObject(
        evaluation.expected,
      );
    }

    expect(posthog.personProperties).toEqual([fixture.context.personProperties]);
    expect(posthog.groups).toEqual([
      {
        type: "company",
        key: "company-7",
        properties: { tier: "enterprise" },
      },
    ]);
    expect(posthog.exposures).toHaveLength(fixture.evaluations.length);
  });

  it("uses the caller default for missing flags and provider failures", async () => {
    const missingPostHog = new FakeNodePostHog(new Map());
    await ServerOpenFeature.setProviderAndWait(
      new PostHogServerProvider(
        missingPostHog as unknown as PostHogNodeClient,
        { sendFeatureFlagEvents: true },
      ),
    );
    const client = ServerOpenFeature.getClient("safe-default-test");

    const missing = await client.getBooleanDetails(
      "checkout-kill-switch",
      false,
      { targetingKey: "person-123" },
    );
    expect(missing).toMatchObject({
      value: false,
      errorCode: ErrorCode.FLAG_NOT_FOUND,
    });
    expect(missingPostHog.exposures).toHaveLength(0);

    const offlinePostHog = new FakeNodePostHog(
      new Map(),
      new Error("offline"),
    );
    await ServerOpenFeature.setProviderAndWait(
      new PostHogServerProvider(
        offlinePostHog as unknown as PostHogNodeClient,
        { sendFeatureFlagEvents: true },
      ),
    );
    const offline = await client.getBooleanDetails(
      "checkout-kill-switch",
      false,
      { targetingKey: "person-123" },
    );
    expect(offline).toMatchObject({
      value: false,
      errorCode: ErrorCode.GENERAL,
    });
    expect(offlinePostHog.exposures).toHaveLength(0);
  });

  it("switches existing clients to an awaited replacement provider", async () => {
    const fixture = await loadFixture();
    const killSwitch = fixture.evaluations.find(
      ({ key }) => key === "checkout-kill-switch",
    );
    if (!killSwitch) throw new Error("Missing kill-switch fixture");
    const enabled = new FakeNodePostHog(
      new Map([[killSwitch.key, killSwitch]]),
    );
    await ServerOpenFeature.setProviderAndWait(
      new PostHogServerProvider(enabled as unknown as PostHogNodeClient),
    );
    const client = ServerOpenFeature.getClient("replacement-test");
    expect(
      await client.getBooleanValue(killSwitch.key, false, {
        targetingKey: "person-123",
      }),
    ).toBe(true);

    const disabledFixture = structuredClone(killSwitch);
    disabledFixture.result.enabled = false;
    disabledFixture.result.reason = "no_condition_match";
    const disabled = new FakeNodePostHog(
      new Map([[disabledFixture.key, disabledFixture]]),
    );
    await ServerOpenFeature.setProviderAndWait(
      new PostHogServerProvider(disabled as unknown as PostHogNodeClient),
    );

    expect(
      await client.getBooleanValue(killSwitch.key, true, {
        targetingKey: "person-123",
      }),
    ).toBe(false);
    expect(enabled.exposures).toHaveLength(1);
    expect(disabled.exposures).toHaveLength(1);
  });

  it("never adds a second exposure through an OpenFeature hook", async () => {
    const fixture = await loadFixture();
    const experiment = fixture.evaluations.find(
      ({ key }) => key === "checkout-experiment",
    );
    if (!experiment) throw new Error("Missing experiment fixture");
    const posthog = new FakeNodePostHog(
      new Map([[experiment.key, experiment]]),
    );
    await ServerOpenFeature.setProviderAndWait(
      new PostHogServerProvider(posthog as unknown as PostHogNodeClient, {
        sendFeatureFlagEvents: true,
      }),
    );

    await ServerOpenFeature.getClient("exposure-test").getStringValue(
      experiment.key,
      "control",
      { targetingKey: "person-123" },
    );

    expect(posthog.exposures).toEqual([
      {
        event: "$feature_flag_called",
        key: experiment.key,
        response: "test",
      },
    ]);
  });

  it("applies the stale-state policy from the shared fixture", async () => {
    const fixture = await loadFixture();
    for (const testCase of fixture.safeDefaults) {
      const value =
        testCase.state === "ready"
          ? (testCase.cached ?? testCase.default)
          : testCase.state === "stale" && !testCase.critical
            ? (testCase.cached ?? testCase.default)
            : testCase.default;
      expect(value).toBe(testCase.expected);
    }
  });

  it("keeps the web and server OpenFeature APIs independent", () => {
    expect(WebOpenFeature.getClient()).not.toBe(
      ServerOpenFeature.getClient("independence-test"),
    );
  });
});
