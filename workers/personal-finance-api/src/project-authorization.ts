import type { AuthorizationPolicy } from "./authorization";

const canaryActions = new Set(["create", "read"]);

// Keep this policy synthetic-only until the product runtime ticket defines the
// complete household membership model.
export const projectAuthorization: AuthorizationPolicy = (session, request) => {
  const prefix = "household-canary:";
  const ownerUserId = request.resourceId.startsWith(prefix)
    ? request.resourceId.slice(prefix.length)
    : null;
  return (
    ownerUserId === session.user.id &&
    canaryActions.has(request.action)
  );
};
