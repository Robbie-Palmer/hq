import {
  generateKeyPairSync,
  type KeyObject,
  randomUUID,
  sign as signBytes,
} from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import {
  expect,
  expectPreviewJSON,
  expectPreviewStatus,
  previewRequest,
  previewSiteURL,
  previewURL,
  test,
} from "./preview-test-helpers";

const agentName = `Playwright recipe agent ${randomUUID()}`;
const hostName = `Playwright recipe host ${randomUUID()}`;
const requestedCapabilities = [
  "recipes.search",
  "recipes.read",
  "recipes.dataset.inspect",
  "recipe_import.create",
  "recipe_import.status",
  "pantry.read",
] as const;
const jwtClockSkewSeconds = 5;
const jwtExpirationSeconds = 60;

type SigningIdentity = {
  kid: string;
  privateKey: KeyObject;
  publicKey: Record<string, unknown>;
};

type Discovery = {
  issuer: string;
  endpoints: {
    execute: string;
    register: string;
    status: string;
  };
};

type Registration = {
  agent_id: string;
  host_id: string;
  status: string;
  approval: {
    method: string;
    user_code: string;
    verification_uri_complete: string;
  };
};

function signingIdentity(prefix: string): SigningIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const kid = `${prefix}-${randomUUID()}`;
  return {
    kid,
    privateKey,
    publicKey: {
      ...publicKey.export({ format: "jwk" }),
      alg: "EdDSA",
      kid,
      use: "sig",
    },
  };
}

function encodedJSON(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signedJWT(input: {
  audience: string;
  identity: SigningIdentity;
  issuer: string;
  payload?: Record<string, unknown>;
  subject?: string;
  type: "agent+jwt" | "host+jwt";
}): string {
  const now = Math.floor(Date.now() / 1_000);
  const protectedHeader = encodedJSON({
    alg: "EdDSA",
    kid: input.identity.kid,
    typ: input.type,
  });
  const payload = encodedJSON({
    ...input.payload,
    aud: input.audience,
    exp: now + jwtExpirationSeconds,
    iat: now - jwtClockSkewSeconds,
    iss: input.issuer,
    jti: randomUUID(),
    ...(input.subject ? { sub: input.subject } : {}),
  });
  const signingInput = `${protectedHeader}.${payload}`;
  const signature = signBytes(
    null,
    Buffer.from(signingInput),
    input.identity.privateKey,
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

function hostJWT(
  identity: SigningIdentity,
  hostId: string,
  issuer: string,
  payload?: Record<string, unknown>,
): string {
  return signedJWT({
    audience: issuer,
    identity,
    issuer: hostId,
    payload,
    type: "host+jwt",
  });
}

function agentJWT(
  identity: SigningIdentity,
  registration: Registration,
  issuer: string,
  capability: string,
): string {
  return signedJWT({
    audience: issuer,
    identity,
    issuer: registration.host_id,
    payload: { capabilities: [capability] },
    subject: registration.agent_id,
    type: "agent+jwt",
  });
}

async function executeCapability<T>(
  context: BrowserContext,
  discovery: Discovery,
  identity: SigningIdentity,
  registration: Registration,
  capability: string,
  arguments_: Record<string, unknown>,
): Promise<T> {
  const token = agentJWT(identity, registration, discovery.issuer, capability);
  const response = await expectPreviewJSON<{ data: T }>(
    context,
    discovery.endpoints.execute,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      data: { capability, arguments: arguments_ },
    },
  );
  return response.data;
}

test.describe("deployed delegated Agent Auth", () => {
  test("approves scoped reads in the UI and enforces revocation", async ({
    createPreviewSession,
  }) => {
    test.setTimeout(60_000);
    const userSession = await createPreviewSession("user-with-recipes");
    const userContext = userSession.context;
    let agentContext: BrowserContext | undefined;
    let hostId: string | undefined;

    try {
      agentContext = (await createPreviewSession()).context;
      const page = userSession.page;

      const discovery = await expectPreviewJSON<Discovery>(
        agentContext,
        "/.well-known/agent-configuration",
      );
      expect(discovery.issuer).toBe(`${previewSiteURL.origin}/api/auth`);
      for (const endpoint of Object.values(discovery.endpoints)) {
        expect(new URL(endpoint).origin).toBe(previewSiteURL.origin);
      }

      const hostIdentity = signingIdentity("playwright-host");
      const agentIdentity = signingIdentity("playwright-agent");
      const pendingHost = await expectPreviewJSON<{
        enrollmentToken: string;
        hostId: string;
        status: string;
      }>(userContext, "/api/auth/host/create", {
        method: "POST",
        data: {
          default_capabilities: [],
          name: hostName,
        },
      });
      expect(pendingHost.status).toBe("pending_enrollment");
      const host = await expectPreviewJSON<{ hostId: string; status: string }>(
        agentContext,
        "/api/auth/host/enroll",
        {
          method: "POST",
          data: {
            name: hostName,
            public_key: hostIdentity.publicKey,
            token: pendingHost.enrollmentToken,
          },
        },
      );
      hostId = host.hostId;
      expect(host.hostId).toBe(pendingHost.hostId);
      expect(host.status).toBe("active");

      const registrationToken = hostJWT(
        hostIdentity,
        host.hostId,
        discovery.issuer,
        {
          agent_public_key: agentIdentity.publicKey,
          host_name: hostName,
        },
      );
      const registration = await expectPreviewJSON<Registration>(
        agentContext,
        discovery.endpoints.register,
        {
          method: "POST",
          headers: { authorization: `Bearer ${registrationToken}` },
          data: {
            capabilities: requestedCapabilities,
            mode: "delegated",
            name: agentName,
            preferred_method: "device_authorization",
            reason: "Test delegated reads against the deployed PR preview",
          },
        },
      );
      expect(registration.status).toBe("pending");
      expect(registration.approval.method).toBe("device_authorization");

      const pendingToken = agentJWT(
        agentIdentity,
        registration,
        discovery.issuer,
        "recipes.search",
      );
      await expectPreviewStatus(
        agentContext,
        discovery.endpoints.execute,
        {
          method: "POST",
          headers: { authorization: `Bearer ${pendingToken}` },
          data: {
            capability: "recipes.search",
            arguments: { query: "Preview" },
          },
        },
        403,
      );

      await page.goto(
        previewURL(registration.approval.verification_uri_complete),
      );
      await expect(
        page.getByRole("heading", { name: `Allow ${agentName}?` }),
      ).toBeVisible();
      await expect(page.getByText(hostName, { exact: true })).toBeVisible();
      await expect(
        page.getByText("recipes-user@preview.invalid", { exact: true }),
      ).toBeVisible();
      for (const capability of requestedCapabilities) {
        await expect(page.getByText(capability, { exact: true })).toBeVisible();
      }

      await page.getByRole("button", { name: "Approve access" }).click();
      await expect(
        page.getByRole("heading", { name: "Agent access approved." }),
      ).toBeVisible();

      const statusToken = hostJWT(hostIdentity, host.hostId, discovery.issuer);
      const status = await expectPreviewJSON<{
        status: string;
        agent_capability_grants: Array<{
          capability: string;
          status: string;
        }>;
      }>(
        agentContext,
        `${discovery.endpoints.status}?agent_id=${encodeURIComponent(registration.agent_id)}`,
        { headers: { authorization: `Bearer ${statusToken}` } },
      );
      expect(status.status).toBe("active");
      for (const capability of requestedCapabilities) {
        expect(status.agent_capability_grants).toContainEqual(
          expect.objectContaining({ capability, status: "active" }),
        );
      }

      const search = await executeCapability<{
        items: Array<{ slug: string }>;
      }>(
        agentContext,
        discovery,
        agentIdentity,
        registration,
        "recipes.search",
        {
          query: "Preview",
          limit: 25,
        },
      );
      const visibleSlugs = new Set(search.items.map(({ slug }) => slug));
      expect(visibleSlugs).toContain("preview-private-weeknight-pasta");
      expect(visibleSlugs).toContain("preview-public-tomato-toast");
      expect(visibleSlugs).not.toContain("preview-admin-soup");
      expect(visibleSlugs).not.toContain("preview-household-veggie-curry");

      const recipe = await executeCapability<{
        recipe: { body: string | null; owned: boolean; slug: string } | null;
      }>(agentContext, discovery, agentIdentity, registration, "recipes.read", {
        slug: "preview-private-weeknight-pasta",
      });
      expect(recipe.recipe).toMatchObject({
        owned: true,
        slug: "preview-private-weeknight-pasta",
      });
      expect(recipe.recipe?.body).toContain("tomato passata");

      const dataset = await executeCapability<{
        population: {
          sampledRecipes: number;
          visibleRecipes: number;
        };
        sample: {
          ingredients: {
            distinct: number;
            top: Array<{ ingredient: string; recipeCount: number }>;
          };
          parseQuality: { invalidPayloads: number; validPayloads: number };
        };
        visibility: { household: number; private: number; public: number };
      }>(
        agentContext,
        discovery,
        agentIdentity,
        registration,
        "recipes.dataset.inspect",
        { sampleSize: 100, top: 10 },
      );
      expect(dataset.population.visibleRecipes).toBe(
        dataset.visibility.public +
          dataset.visibility.household +
          dataset.visibility.private,
      );
      expect(dataset.population.sampledRecipes).toBeLessThanOrEqual(100);
      expect(dataset.visibility).toMatchObject({
        household: 0,
        private: 1,
        public: 2,
      });
      expect(dataset.sample.parseQuality).toMatchObject({
        invalidPayloads: 0,
        validPayloads: 3,
      });
      expect(dataset.sample.ingredients.distinct).toBeGreaterThanOrEqual(5);
      expect(dataset.sample.ingredients.top).toContainEqual(
        expect.objectContaining({ ingredient: "bread", recipeCount: 2 }),
      );
      expect(JSON.stringify(dataset)).not.toContain(
        "preview-private-weeknight-pasta",
      );

      const importStatus = await executeCapability<{ imports: unknown[] }>(
        agentContext,
        discovery,
        agentIdentity,
        registration,
        "recipe_import.status",
        { limit: 20 },
      );
      expect(importStatus.imports).toHaveLength(0);
      expect(JSON.stringify(importStatus)).not.toMatch(
        /r2Key|prompt|preview|source/,
      );

      const pantry = await executeCapability<{
        itemVersions: Record<string, string>;
        revision: string;
        scope: string;
        stock: Record<string, string>;
      }>(
        agentContext,
        discovery,
        agentIdentity,
        registration,
        "pantry.read",
        {},
      );
      expect(pantry).toMatchObject({
        scope: "personal",
        stock: { "penne-pasta": "cupboards" },
      });
      expect(pantry.revision).toMatch(/^\d+$/);
      expect(pantry.itemVersions["penne-pasta"]).toMatch(/^\d+$/);

      await page.goto("/recipes/settings?section=agents");
      const agentCard = page.locator("article").filter({ hasText: agentName });
      await expect(agentCard).toBeVisible();
      await expect(
        agentCard.getByText("Active", { exact: true }),
      ).toBeVisible();
      for (const capability of requestedCapabilities) {
        await expect(
          agentCard.getByText(capability, { exact: true }),
        ).toBeVisible();
      }

      page.once("dialog", (dialog) => dialog.accept());
      await agentCard.getByRole("button", { name: "Revoke access" }).click();
      await expect(
        agentCard.getByText("Revoked", { exact: true }),
      ).toBeVisible();
      const revokedToken = agentJWT(
        agentIdentity,
        registration,
        discovery.issuer,
        "recipes.read",
      );
      await expectPreviewStatus(
        agentContext,
        discovery.endpoints.execute,
        {
          method: "POST",
          headers: { authorization: `Bearer ${revokedToken}` },
          data: {
            capability: "recipes.read",
            arguments: { slug: "preview-private-weeknight-pasta" },
          },
        },
        403,
      );
    } finally {
      if (hostId) {
        const cleanup = await previewRequest(
          userContext,
          "/api/auth/host/revoke",
          {
            method: "POST",
            data: { host_id: hostId },
          },
        ).catch(() => undefined);
        await cleanup?.dispose();
      }
    }
  });
});
