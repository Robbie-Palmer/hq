import type { BusinessRealisationResult } from "./businessRealisation";
import type { HouseholdWealthConsolidation } from "./businessWealthConsolidation";

export type ReconciledBusinessRealisation = {
  asOfDate: string;
  knownSubtotal: number;
  complete: boolean;
  removedContributionIds: string[];
  addedRealisationProceeds: number;
  futureRealisationProceeds: number;
  destinationAccountContributionIds: string[];
  excludedRealisationDistributionOwnerIds: string[];
  eliminatedTransferIds: string[];
};

export function reconcileBusinessRealisation(input: {
  consolidation: HouseholdWealthConsolidation;
  realisation: BusinessRealisationResult;
  asOfDate: string;
}): ReconciledBusinessRealisation {
  const completed =
    input.realisation.grossProceeds.receivedAt <= input.asOfDate;
  const replacementId = input.realisation.doubleCounting.replacesContributionId;
  const replacedContribution = input.consolidation.contributions.find(
    ({ id }) => id === replacementId,
  );
  const removedAmount =
    completed && replacedContribution != null ? replacedContribution.amount : 0;
  const removedContributionIds =
    completed && replacedContribution != null ? [replacedContribution.id] : [];
  const destinationAccountContributionIds: string[] = [];
  const excludedRealisationDistributionOwnerIds: string[] = [];
  let addedRealisationProceeds = 0;
  let futureRealisationProceeds = 0;

  for (const distribution of input.realisation.distributions) {
    if (distribution.netAmount == null) continue;
    if (distribution.availableAt > input.asOfDate) {
      futureRealisationProceeds += distribution.netAmount;
      continue;
    }
    const accountContributionId =
      distribution.destinationAccountId == null
        ? null
        : `account:${distribution.destinationAccountId}`;
    if (
      accountContributionId != null &&
      input.consolidation.includedContributionIds.includes(
        accountContributionId,
      )
    ) {
      destinationAccountContributionIds.push(accountContributionId);
      excludedRealisationDistributionOwnerIds.push(distribution.ownerEntityId);
      continue;
    }
    addedRealisationProceeds += distribution.netAmount;
  }

  return {
    asOfDate: input.asOfDate,
    knownSubtotal:
      input.consolidation.knownSubtotal -
      removedAmount +
      addedRealisationProceeds,
    complete: input.consolidation.complete && input.realisation.complete,
    removedContributionIds,
    addedRealisationProceeds,
    futureRealisationProceeds,
    destinationAccountContributionIds,
    excludedRealisationDistributionOwnerIds,
    eliminatedTransferIds:
      input.realisation.doubleCounting.eliminatedTransferIds,
  };
}
