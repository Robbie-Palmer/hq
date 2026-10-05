function capabilityName(request) {
  return typeof request === "string" ? request : request?.name;
}

function grantIsActive(grant, now) {
  if (grant?.status !== "active") return false;
  if (!grant.expires_at) return true;
  const expiresAt = Date.parse(grant.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function selectReusableConnection(
  connections,
  { issuer, mode, capabilities },
  now = Date.now(),
) {
  const requestedCapabilities = new Set(
    (capabilities ?? []).map(capabilityName).filter(Boolean),
  );
  return connections
    .filter((connection) => connection.issuer === issuer)
    .filter((connection) => !mode || connection.mode === mode)
    .filter((connection) => {
      const activeCapabilities = new Set(
        (connection.capabilityGrants ?? [])
          .filter((grant) => grantIsActive(grant, now))
          .map((grant) => grant.capability),
      );
      return (
        activeCapabilities.size > 0 &&
        [...requestedCapabilities].every((name) =>
          activeCapabilities.has(name),
        )
      );
    })
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))[0];
}

export async function reuseConnection(storage, client, args) {
  if (args.force_approval) return null;
  const hasConstrainedCapability = (args.capabilities ?? []).some(
    (capability) =>
      typeof capability === "object" && capability?.constraints != null,
  );
  if (hasConstrainedCapability) return null;

  const provider = await client.getProviderConfig(args.provider);
  const connection = selectReusableConnection(
    await storage.listAgentConnections(),
    {
      issuer: provider.issuer,
      mode: args.mode,
      capabilities: args.capabilities,
    },
  );
  if (!connection) return null;
  return {
    agentId: connection.agentId,
    hostId: connection.hostId,
    status: "active",
    capabilityGrants: connection.capabilityGrants,
    reused: true,
  };
}
