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
