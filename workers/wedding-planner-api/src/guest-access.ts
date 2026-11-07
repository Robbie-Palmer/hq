import {
  canViewGuestField,
  updateGuest,
  updateGuestCustomField,
  visibleGuest,
  type CustomFieldValue,
  type GuestActor,
  type WeddingGuest,
} from "wedding-planner-domain";
import { createCedarGuestFieldAuthorizer } from "wedding-planner-domain/guest-authorization-cedar";
import type { WeddingPlanStore } from "wedding-planner-data";

const cedarGuestFieldAuthorizer = createCedarGuestFieldAuthorizer();

export type TrustedWeddingIdentity = {
  actor: GuestActor;
  ownerId: string;
};

export class WeddingPlanUnavailableError extends Error {
  constructor() {
    super("The wedding plan is unavailable");
    this.name = "WeddingPlanUnavailableError";
  }
}

export class GuestAccessDeniedError extends Error {
  constructor() {
    super("The authenticated actor cannot access this guest");
    this.name = "GuestAccessDeniedError";
  }
}

export function createGuestAccessService(
  plans: Pick<WeddingPlanStore, "load" | "update">,
) {
  async function loadPlan(identity: TrustedWeddingIdentity) {
    const stored = await plans.load(identity.ownerId);
    if (!stored) throw new WeddingPlanUnavailableError();
    return stored;
  }

  function requireGuestAccess(
    identity: TrustedWeddingIdentity,
    plan: Awaited<ReturnType<typeof loadPlan>>["plan"],
    guestId: string,
  ) {
    if (
      !canViewGuestField(
        plan,
        guestId,
        "id",
        identity.actor,
        cedarGuestFieldAuthorizer,
      )
    ) {
      throw new GuestAccessDeniedError();
    }
  }

  return {
    async readGuest(
      identity: TrustedWeddingIdentity,
      guestId: string,
    ): Promise<Partial<WeddingGuest>> {
      const stored = await loadPlan(identity);
      requireGuestAccess(identity, stored.plan, guestId);
      return visibleGuest(
        stored.plan,
        guestId,
        identity.actor,
        cedarGuestFieldAuthorizer,
      );
    },

    async updateGuest(
      identity: TrustedWeddingIdentity,
      guestId: string,
      patch: Partial<WeddingGuest>,
      changedAt: string,
    ): Promise<Partial<WeddingGuest>> {
      const stored = await loadPlan(identity);
      requireGuestAccess(identity, stored.plan, guestId);
      const plan = structuredClone(stored.plan);
      updateGuest(
        plan,
        guestId,
        patch,
        identity.actor,
        changedAt,
        "api",
        cedarGuestFieldAuthorizer,
      );
      const updated = await plans.update(
        identity.ownerId,
        stored.revision,
        plan,
      );
      return visibleGuest(
        updated.plan,
        guestId,
        identity.actor,
        cedarGuestFieldAuthorizer,
      );
    },

    async updateGuestCustomField(
      identity: TrustedWeddingIdentity,
      guestId: string,
      fieldId: string,
      value: CustomFieldValue,
      changedAt: string,
    ): Promise<Partial<WeddingGuest>> {
      const stored = await loadPlan(identity);
      requireGuestAccess(identity, stored.plan, guestId);
      const plan = structuredClone(stored.plan);
      updateGuestCustomField(
        plan,
        guestId,
        fieldId,
        value,
        identity.actor,
        changedAt,
        "api",
        cedarGuestFieldAuthorizer,
      );
      const updated = await plans.update(
        identity.ownerId,
        stored.revision,
        plan,
      );
      return visibleGuest(
        updated.plan,
        guestId,
        identity.actor,
        cedarGuestFieldAuthorizer,
      );
    },
  };
}

export type GuestAccessService = ReturnType<typeof createGuestAccessService>;
