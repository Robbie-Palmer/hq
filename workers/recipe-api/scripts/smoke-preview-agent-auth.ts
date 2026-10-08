import {
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { requiredEnv } from "node-base/env";
import { betterAuthSessionCookie } from "../src/better-auth-session-cookie";

const REQUEST_TIMEOUT_MS = 15_000;
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const APPROVAL_POLL_MS = 2_000;

function previewSiteURL(): string {
  const siteURL = new URL(requiredEnv("PREVIEW_SITE_URL"));
  const pagesHost =
    process.env.CLOUDFLARE_PAGES_HOST ?? "personal-site-bu5.pages.dev";
  if (
    siteURL.protocol !== "https:" ||
    !/^pr-[1-9]\d*$/.test(siteURL.hostname.split(".")[0] ?? "") ||
    siteURL.hostname !== `${siteURL.hostname.split(".")[0]}.${pagesHost}` ||
    siteURL.pathname !== "/"
  ) {
    throw new Error(
      `Refusing to send Access credentials to non-preview URL: ${siteURL.href}`,
    );
  }
  return siteURL.origin;
}

const siteURL = previewSiteURL();
const accessHeaders = {
  "CF-Access-Client-Id": requiredEnv("CF_ACCESS_CLIENT_ID"),
  "CF-Access-Client-Secret": requiredEnv("CF_ACCESS_CLIENT_SECRET"),
};

async function request(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(input, siteURL);
  if (url.origin !== siteURL) {
    throw new Error(`Refusing cross-origin preview request: ${url.href}`);
  }
  return fetch(url, {
    ...init,
    headers: { ...accessHeaders, origin: siteURL, ...init.headers },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function expectJson<T>(
  input: string,
  init: RequestInit = {},
  expectedStatus = 200,
): Promise<T> {
  const response = await request(input, init);
  if (response.status !== expectedStatus) {
    const body = (await response.text()).slice(0, 2_000);
    throw new Error(
      `${init.method ?? "GET"} ${new URL(input, siteURL).pathname} returned ${response.status}: ${body}`,
    );
  }
  return response.json() as Promise<T>;
}

type Discovery = {
  issuer: string;
  endpoints: {
    register: string;
    execute: string;
    status: string;
  };
};

type Approval = {
  device_code: string;
  expires_in: number;
  interval: number;
  method: "device_authorization";
  user_code: string;
  verification_uri_complete: string;
};

type Registration = {
  agent_id: string;
  host_id: string;
  status: string;
  approval: Approval;
};

type AgentStatus = {
  status: string;
  agent_capability_grants: Array<{
    capability: string;
    status: string;
  }>;
};

async function publicJWK(publicKey: CryptoKey, kid: string): Promise<JWK> {
  return {
    ...(await exportJWK(publicKey)),
    alg: "EdDSA",
    kid,
    use: "sig",
  };
}

async function signedJWT(
  privateKey: CryptoKey,
  protectedHeader: { kid: string; typ: "agent+jwt" | "host+jwt" },
  payload: Record<string, unknown>,
  issuer: string,
  audience: string,
  subject?: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  let token = new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", ...protectedHeader })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 45)
    .setJti(crypto.randomUUID());
  if (subject) token = token.setSubject(subject);
  return token.sign(privateKey);
}

async function hostJWT(
  privateKey: CryptoKey,
  kid: string,
  hostId: string,
  issuer: string,
  payload: Record<string, unknown> = {},
): Promise<string> {
  return signedJWT(
    privateKey,
    { kid, typ: "host+jwt" },
    payload,
    hostId,
    issuer,
  );
}

async function agentJWT(
  privateKey: CryptoKey,
  kid: string,
  agentId: string,
  hostId: string,
  issuer: string,
  capability: string,
): Promise<string> {
  return signedJWT(
    privateKey,
    { kid, typ: "agent+jwt" },
    { capabilities: [capability] },
    hostId,
    issuer,
    agentId,
  );
}

async function execute(
  endpoint: string,
  token: string,
  capability: string,
  args: Record<string, unknown>,
): Promise<Response> {
  return request(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ capability, arguments: args }),
  });
}

const discovery = await expectJson<Discovery>(
  "/.well-known/agent-configuration",
);
if (
  !discovery.issuer.startsWith(`${siteURL}/api/auth`) ||
  !Object.values(discovery.endpoints).every((endpoint) =>
    endpoint.startsWith(`${siteURL}/api/auth/`),
  )
) {
  throw new Error("Agent discovery returned endpoints outside the PR preview");
}

const signIn = await request("/api/auth/preview/sign-in", {
  method: "POST",
  headers: { "content-type": "application/json", origin: siteURL },
  body: JSON.stringify({ scenario: "user-with-recipes" }),
});
if (!signIn.ok) {
  throw new Error(`Preview sign-in failed (${signIn.status})`);
}
const cookie = await betterAuthSessionCookie(signIn);

const cookingSessionId = crypto.randomUUID();
const cookingSession = {
  sessionId: cookingSessionId,
  recipeSlug: "preview-private-weeknight-pasta",
  recipeTitle: "Preview Weeknight Pasta",
  servings: 2,
};
await expectJson(
  "/api/profile/cooking-sessions",
  {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: siteURL,
    },
    body: JSON.stringify({ ...cookingSession, event: "started" }),
  },
  201,
);
await expectJson("/api/profile/cooking-sessions", {
  method: "POST",
  headers: {
    cookie,
    "content-type": "application/json",
    origin: siteURL,
  },
  body: JSON.stringify({ ...cookingSession, event: "completed" }),
});

const hostKeys = await generateKeyPair("EdDSA");
const agentKeys = await generateKeyPair("EdDSA");
const hostKid = `preview-host-${crypto.randomUUID()}`;
const agentKid = `preview-agent-${crypto.randomUUID()}`;
const hostPublicKey = await publicJWK(hostKeys.publicKey, hostKid);
const agentPublicKey = await publicJWK(agentKeys.publicKey, agentKid);
const requestedCapabilities = [
  "recipes.search",
  "recipes.read",
  "recipes.dataset.inspect",
  "recipe_import.create",
  "recipe_import.status",
  "pantry.read",
  "cook_log.read",
  "cooking_insights.read",
];

const pendingHost = await expectJson<{
  enrollmentToken: string;
  hostId: string;
  status: string;
}>(
  "/api/auth/host/create",
  {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: siteURL,
    },
    body: JSON.stringify({
      name: "ADR 061 preview smoke host",
      default_capabilities: [],
    }),
  },
);
if (pendingHost.status !== "pending_enrollment") {
  throw new Error(`Preview host has unexpected status: ${pendingHost.status}`);
}
const host = await expectJson<{ hostId: string; status: string }>(
  "/api/auth/host/enroll",
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "ADR 061 preview smoke host",
      public_key: hostPublicKey,
      token: pendingHost.enrollmentToken,
    }),
  },
);
if (host.hostId !== pendingHost.hostId || host.status !== "active") {
  throw new Error(`Preview host has unexpected status: ${host.status}`);
}

const registrationToken = await hostJWT(
  hostKeys.privateKey,
  hostKid,
  host.hostId,
  discovery.issuer,
  {
    agent_public_key: agentPublicKey,
    host_name: "ADR 061 preview smoke host",
  },
);
const registration = await expectJson<Registration>(
  discovery.endpoints.register,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${registrationToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "ADR 061 preview smoke agent",
      capabilities: requestedCapabilities,
      reason:
        "Verify delegated recipe, pantry, and cooking-history reads on PR preview",
      mode: "delegated",
      preferred_method: "device_authorization",
    }),
  },
);
if (
  registration.status !== "pending" ||
  registration.approval.method !== "device_authorization"
) {
  throw new Error(`Agent has unexpected status: ${registration.status}`);
}

const pendingToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "recipes.search",
);
const pendingExecution = await execute(
  discovery.endpoints.execute,
  pendingToken,
  "recipes.search",
  { query: "Preview" },
);
if (pendingExecution.status !== 403) {
  throw new Error(
    `Pending agent execution returned ${pendingExecution.status}, expected 403`,
  );
}

console.log(
  "Approval request created. Open it from the preview notification bell.",
);
console.log("Waiting for approval...");

function positiveFiniteOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

const expiresInSeconds = positiveFiniteOr(
  registration.approval.expires_in,
  APPROVAL_TIMEOUT_MS / 1_000,
);
const intervalSeconds = positiveFiniteOr(
  registration.approval.interval,
  APPROVAL_POLL_MS / 1_000,
);
const deadline =
  Date.now() +
  Math.min(APPROVAL_TIMEOUT_MS, expiresInSeconds * 1_000);
const pollInterval = Math.max(
  APPROVAL_POLL_MS,
  intervalSeconds * 1_000,
);
let status: AgentStatus | undefined;
while (Date.now() < deadline) {
  const statusToken = await hostJWT(
    hostKeys.privateKey,
    hostKid,
    host.hostId,
    discovery.issuer,
  );
  const statusResponse = await request(
    `${discovery.endpoints.status}?agent_id=${encodeURIComponent(registration.agent_id)}`,
    { headers: { authorization: `Bearer ${statusToken}` } },
  );
  if (statusResponse.status >= 500) {
    await statusResponse.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    continue;
  }
  if (!statusResponse.ok) {
    throw new Error(
      `Agent status returned ${statusResponse.status}: ${(await statusResponse.text()).slice(0, 2_000)}`,
    );
  }
  status = (await statusResponse.json()) as AgentStatus;
  if (status.status === "active") break;
  if (["rejected", "revoked", "expired"].includes(status.status)) {
    throw new Error(`Agent approval ended with status: ${status.status}`);
  }
  await new Promise((resolve) => setTimeout(resolve, pollInterval));
}
if (status?.status !== "active") {
  throw new Error("Timed out waiting for agent approval");
}
for (const capability of requestedCapabilities) {
  if (
    !status.agent_capability_grants.some(
      (grant) =>
        grant.capability === capability && grant.status === "active",
    )
  ) {
    throw new Error(`Approved agent is missing ${capability}`);
  }
}

const searchToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "recipes.search",
);
const searchResponse = await execute(
  discovery.endpoints.execute,
  searchToken,
  "recipes.search",
  { query: "Preview", limit: 25 },
);
if (!searchResponse.ok) {
  throw new Error(`Recipe search failed: ${await searchResponse.text()}`);
}
const search = (await searchResponse.json()) as {
  data: { items: Array<{ slug: string }> };
};
const slugs = new Set(search.data.items.map((recipe) => recipe.slug));
if (
  !slugs.has("preview-private-weeknight-pasta") ||
  !slugs.has("preview-public-tomato-toast") ||
  slugs.has("preview-admin-soup") ||
  slugs.has("preview-household-veggie-curry")
) {
  throw new Error(`Recipe search returned the wrong visibility set: ${[...slugs]}`);
}

const replay = await execute(
  discovery.endpoints.execute,
  searchToken,
  "recipes.search",
  { query: "Preview", limit: 25 },
);
if (replay.status !== 401) {
  throw new Error(`JWT replay returned ${replay.status}, expected 401`);
}

const readToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "recipes.read",
);
const readResponse = await execute(
  discovery.endpoints.execute,
  readToken,
  "recipes.read",
  { slug: "preview-private-weeknight-pasta" },
);
if (!readResponse.ok) {
  throw new Error(`Recipe read failed: ${await readResponse.text()}`);
}
const read = (await readResponse.json()) as {
  data: { recipe: { body: string | null; owned: boolean; slug: string } | null };
};
if (
  read.data.recipe?.slug !== "preview-private-weeknight-pasta" ||
  read.data.recipe.owned !== true ||
  !read.data.recipe.body
) {
  throw new Error("Recipe read did not return the delegated user's private recipe");
}

const datasetToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "recipes.dataset.inspect",
);
const datasetResponse = await execute(
  discovery.endpoints.execute,
  datasetToken,
  "recipes.dataset.inspect",
  { sampleSize: 100, top: 10 },
);
if (!datasetResponse.ok) {
  throw new Error(
    `Recipe dataset inspection failed: ${await datasetResponse.text()}`,
  );
}
const dataset = (await datasetResponse.json()) as {
  data: {
    population: { visibleRecipes: number; sampledRecipes: number };
    visibility: { public: number; private: number };
    sample: {
      parseQuality: { validPayloads: number };
      ingredients: { distinct: number };
    };
  };
};
if (
  dataset.data.population.visibleRecipes < 2 ||
  dataset.data.population.sampledRecipes < 2 ||
  dataset.data.visibility.public < 1 ||
  dataset.data.visibility.private < 1 ||
  dataset.data.sample.parseQuality.validPayloads < 2 ||
  dataset.data.sample.ingredients.distinct < 1
) {
  throw new Error("Recipe dataset inspection omitted seeded visible recipes");
}

const importStatusToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "recipe_import.status",
);
const importStatusResponse = await execute(
  discovery.endpoints.execute,
  importStatusToken,
  "recipe_import.status",
  { limit: 20 },
);
if (!importStatusResponse.ok) {
  throw new Error(
    `Recipe import status failed: ${await importStatusResponse.text()}`,
  );
}
const importStatus = (await importStatusResponse.json()) as {
  data: { imports: unknown[] };
};
if (
  importStatus.data.imports.length > 20 ||
  /r2Key|prompt|preview|source/.test(JSON.stringify(importStatus.data))
) {
  throw new Error("Recipe import status exposed unbounded or private data");
}

const pantryToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "pantry.read",
);
const pantryResponse = await execute(
  discovery.endpoints.execute,
  pantryToken,
  "pantry.read",
  {},
);
if (!pantryResponse.ok) {
  throw new Error(`Pantry read failed: ${await pantryResponse.text()}`);
}
const pantry = (await pantryResponse.json()) as {
  data: {
    resourceId: string;
    scope: "personal" | "household";
    revision: string;
    stock: Record<string, string>;
    itemVersions: Record<string, string>;
  };
};
if (
  pantry.data.scope !== "personal" ||
  pantry.data.resourceId.length === 0 ||
  pantry.data.stock["penne-pasta"] !== "cupboards" ||
  !/^\d+$/.test(pantry.data.revision) ||
  !/^\d+$/.test(pantry.data.itemVersions["penne-pasta"] ?? "")
) {
  throw new Error("Pantry read did not return the delegated user's current pantry");
}

const cookLogToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "cook_log.read",
);
const cookLogResponse = await execute(
  discovery.endpoints.execute,
  cookLogToken,
  "cook_log.read",
  { limit: 50 },
);
if (!cookLogResponse.ok) {
  throw new Error(`Cook log read failed: ${await cookLogResponse.text()}`);
}
const cookLog = (await cookLogResponse.json()) as {
  data: { items: Array<{ id: string; recipeSlug: string }> };
};
if (
  !cookLog.data.items.some(
    (item) =>
      item.id === cookingSessionId &&
      item.recipeSlug === "preview-private-weeknight-pasta",
  )
) {
  throw new Error("Cook log read did not return the delegated user's session");
}

const insightsToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "cooking_insights.read",
);
const insightsResponse = await execute(
  discovery.endpoints.execute,
  insightsToken,
  "cooking_insights.read",
  {},
);
if (!insightsResponse.ok) {
  throw new Error(`Cooking insights read failed: ${await insightsResponse.text()}`);
}
const insights = (await insightsResponse.json()) as {
  data: {
    cookModeStarts: number;
    mealsCooked: number;
    recent: Array<{ id: string }>;
  };
};
if (
  insights.data.cookModeStarts < 1 ||
  insights.data.mealsCooked < 1 ||
  !insights.data.recent.some((item) => item.id === cookingSessionId)
) {
  throw new Error("Cooking insights did not include the preview cooking session");
}

const revoked = await expectJson<{ agent_id: string; status: string }>(
  "/api/auth/agent/revoke",
  {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: siteURL,
    },
    body: JSON.stringify({ agent_id: registration.agent_id }),
  },
);
if (
  revoked.agent_id !== registration.agent_id ||
  revoked.status !== "revoked"
) {
  throw new Error("Agent revocation returned an unexpected response");
}
const revokedToken = await agentJWT(
  agentKeys.privateKey,
  agentKid,
  registration.agent_id,
  registration.host_id,
  discovery.issuer,
  "recipes.read",
);
const revokedExecution = await execute(
  discovery.endpoints.execute,
  revokedToken,
  "recipes.read",
  { slug: "preview-private-weeknight-pasta" },
);
if (revokedExecution.status !== 403) {
  throw new Error(
    `Revoked agent execution returned ${revokedExecution.status}, expected 403`,
  );
}
await expectJson("/api/profile/cooking-insights", {
  headers: { cookie },
});

console.log("Delegated agent-auth preview smoke test passed.");
