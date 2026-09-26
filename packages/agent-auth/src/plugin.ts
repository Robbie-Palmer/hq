import {
  agentAuth,
  type AgentAuthOptions,
} from "@better-auth/agent-auth";

const DEFAULT_AGENT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export function createAgentAuthPlugin(options: AgentAuthOptions) {
  const capabilities = options.capabilities ?? [];
  return agentAuth({
    modes: ["delegated"],
    approvalMethods: ["device_authorization"],
    allowDynamicHostRegistration: false,
    defaultHostCapabilities: [],
    jwtMaxAge: 60,
    agentSessionTTL: DEFAULT_AGENT_LIFETIME_SECONDS,
    agentMaxLifetime: DEFAULT_AGENT_LIFETIME_SECONDS,
    absoluteLifetime: 90 * 24 * 60 * 60,
    jtiCacheStorage: "secondary-storage",
    jwksCacheStorage: "secondary-storage",
    ...options,
    validateCapabilities:
      options.validateCapabilities ??
      ((requested) =>
        requested.every((name) =>
          capabilities.some((capability) => capability.name === name),
        )),
  });
}
