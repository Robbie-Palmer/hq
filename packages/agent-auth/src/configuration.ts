import type { AgentAuthOptions } from "@better-auth/agent-auth";

const DEFAULT_ENDPOINT_PATHS = {
  register: "/agent/register",
  capabilities: "/capability/list",
  describe_capability: "/capability/describe",
  execute: "/capability/execute",
  request_capability: "/agent/request-capability",
  status: "/agent/status",
  reactivate: "/agent/reactivate",
  revoke: "/agent/revoke",
  revoke_host: "/host/revoke",
  rotate_key: "/agent/rotate-key",
  rotate_host_key: "/host/rotate-key",
  introspect: "/agent/introspect",
} as const;

export type AgentAuthConfigurationOptions = {
  baseUrl: string;
  providerName: string;
  description: string;
  modes?: NonNullable<AgentAuthOptions["modes"]>;
  approvalMethods?: NonNullable<AgentAuthOptions["approvalMethods"]>;
  algorithms?: string[];
  endpointPaths?: Partial<Record<keyof typeof DEFAULT_ENDPOINT_PATHS, string>>;
};

export function createAgentAuthConfiguration(
  options: AgentAuthConfigurationOptions,
) {
  const issuer = `${new URL(options.baseUrl).origin}/api/auth`;
  const paths = { ...DEFAULT_ENDPOINT_PATHS, ...options.endpointPaths };
  const endpoints = Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [name, `${issuer}${path}`]),
  );

  return {
    version: "1.0-draft",
    provider_name: options.providerName,
    description: options.description,
    issuer,
    default_location: endpoints.execute,
    algorithms: options.algorithms ?? ["Ed25519"],
    modes: options.modes ?? ["delegated"],
    approval_methods: options.approvalMethods ?? ["device_authorization"],
    endpoints,
  };
}
