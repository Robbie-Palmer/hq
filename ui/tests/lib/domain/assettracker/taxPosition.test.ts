import { describe, expect, it } from "vitest";
import { getDemoAssetTrackerData } from "@/lib/assettracker/demoData";
import {
  AssetTrackerDataSchema,
  buildHouseholdTaxRequest,
  getHouseholdTaxEstimate,
} from "@/lib/domain/assettracker";

describe("household tax position", () => {
  it("builds an explainable estimate from browser-local demo records", () => {
    const data = getDemoAssetTrackerData();
    const result = getHouseholdTaxEstimate(data);

    expect(result.available).toBe(true);
    expect(result.totalTaxPence).toBe(2_120_621);
    expect(result.people).toHaveLength(2);
    expect(result.lineage.ruleDatasetVersion).toBe("2026.10.2");
    expect(result.lineage.observedRecordIds).toContain(
      "alex-payroll-to-date-2026-10-04",
    );
    expect(result.lineage.assumptionRecordIds).toContain(
      "alex-pay-forecast-2026-27",
    );
    expect(result.lineage.observedRecordIds).toContain(
      "marcus-interest-certificate-2026-27",
    );
    expect(result.lineage.assumptionRecordIds).toContain(
      "tax-profile-alex-2026-27",
    );
    expect(
      result.people.find(({ memberId }) => memberId === "sam")
        ?.excludedWrapperRecordIds,
    ).toContain("sam-isa-dividend-2026-27");
    expect(
      result.people.find(({ memberId }) => memberId === "sam")?.savingsTax
        .amountPence,
    ).toBe(10_000);
    expect(
      result.people.find(({ memberId }) => memberId === "sam")?.allowances
        .personalSavingsAllowancePence,
    ).toBe(100_000);
    const alex = result.people.find(({ memberId }) => memberId === "alex");
    expect(alex?.bandConsumption.observed.taxableIncomePence).toBe(3_863_000);
    expect(alex?.bandConsumption.projected.taxableIncomePence).toBe(4_863_000);
    expect(alex?.bandConsumption.projected.bands[1]?.dividendsPence).toBe(
      93_000,
    );
    expect(alex?.allowances.pensionObservedContributionsPence).toBe(800_000);
    expect(alex?.allowances.pensionContributionsPence).toBe(1_000_000);
    const sam = result.people.find(({ memberId }) => memberId === "sam");
    expect(sam?.allowances.isaObservedContributionsPence).toBe(400_000);
    expect(sam?.allowances.isaContributionsPence).toBe(600_000);
  });

  it("migrates older browser data and blocks a total until profiles exist", () => {
    const data = AssetTrackerDataSchema.parse({ accounts: [], snapshots: [] });
    const result = getHouseholdTaxEstimate(data);

    expect(data.taxPosition).toBeUndefined();
    expect(result.available).toBe(false);
    expect(result.totalTaxPence).toBeNull();
    expect(result.unsupported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-tax-profile" }),
      ]),
    );
  });

  it("flags a referenced account without a tax wrapper", () => {
    const data = getDemoAssetTrackerData();
    if (data.taxPosition == null) throw new Error("Expected demo tax records");
    const disposal = data.taxPosition.disposals[0];
    if (disposal == null) throw new Error("Expected demo disposal");
    data.taxPosition.disposals[0] = {
      ...disposal,
      accountId: "home",
    };

    expect(buildHouseholdTaxRequest(data).unsupportedCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-account-wrapper" }),
      ]),
    );
  });
});
