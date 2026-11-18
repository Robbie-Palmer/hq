import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapterState = vi.hoisted(() => ({
  apiCalls: [] as string[],
  disposeCalls: 0,
  loadCalls: 0,
  operations: [] as string[],
  resetCalls: 0,
}));

vi.mock(
  "@/app/_projects/personal-finance-app/state/asset-tracker-command-adapter",
  () => {
    const api = new Proxy(
      {},
      {
        get: (_target, property) => async () => {
          adapterState.apiCalls.push(String(property));
        },
      },
    );
    return {
      createAssetTrackerCommandAdapter: () => ({
        dispose: () => {
          adapterState.disposeCalls += 1;
        },
        getApi: () => api,
        load: async () => {
          adapterState.loadCalls += 1;
        },
        reset: async (command: (target: object) => Promise<unknown>) => {
          adapterState.resetCalls += 1;
          await command(api);
        },
        run: async (
          operation: string,
          command: (target: object) => Promise<unknown>,
        ) => {
          adapterState.operations.push(operation);
          await command(api);
        },
      }),
    };
  },
);

import {
  type AssetTrackerContextValue,
  AssetTrackerProvider,
  useAssetTracker,
} from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import { selectAssetTrackerFields } from "@/app/_projects/personal-finance-app/components/asset-tracker-selectors";
import { createAssetTrackerBackup } from "@/app/_projects/personal-finance-app/domain";
import { getDemoAssetTrackerData } from "@/app/_projects/personal-finance-app/lib";

let tracker: AssetTrackerContextValue | null = null;

function CaptureTracker() {
  tracker = useAssetTracker();
  return null;
}

function getTracker(): AssetTrackerContextValue {
  if (tracker == null)
    throw new Error("Asset Tracker context was not captured");
  return tracker;
}

function renderProvider(children: ReactNode = <CaptureTracker />) {
  return render(<AssetTrackerProvider>{children}</AssetTrackerProvider>);
}

const commandMappings = [
  ["createAccount", "createAccount", "account created"],
  ["recordBalance", "recordBalance", "balance recorded"],
  ["recordTransfer", "recordTransfer", "transfer recorded"],
  ["closeAccount", "closeAccount", "account closed"],
  ["clearAccountHistory", "clearAccountHistory", "account history cleared"],
  ["deleteSnapshot", "deleteSnapshot", "snapshot deleted"],
  ["deleteCapitalFlow", "deleteCapitalFlow", "capital flow deleted"],
  ["importAccountHistory", "importAccountHistory", "account history imported"],
  ["importIncomeHistory", "importIncomeHistory", "income history imported"],
  ["importSalaryHistory", "importSalaryHistory", "salary history imported"],
  ["acceptHmrcImport", "acceptHmrcImport", "HMRC import accepted"],
  ["saveSalaryRecord", "saveSalaryRecord", "salary record saved"],
  ["deleteSalaryRecord", "deleteSalaryRecord", "salary record deleted"],
  ["saveTaxSetup", "saveTaxSetup", "tax setup saved"],
  ["clearIncomeHistory", "clearIncomeHistory", "income history cleared"],
  ["addRecurringFlow", "addRecurringFlow", "recurring flow added"],
  ["createPlanningCase", "createPlanningCase", "planning case created"],
  [
    "addPlanningChecklistItem",
    "addPlanningChecklistItem",
    "planning checklist item added",
  ],
  [
    "setPlanningChecklistItemStatus",
    "setPlanningChecklistItemStatus",
    "planning checklist status changed",
  ],
  ["addCommitment", "addCommitment", "commitment added"],
  ["addCashFlowDecision", "addCashFlowDecision", "cash-flow decision added"],
  [
    "updateCashFlowDecision",
    "updateCashFlowDecision",
    "cash-flow decision updated",
  ],
  [
    "setCashFlowDecisionStatus",
    "setCashFlowDecisionStatus",
    "cash-flow decision status changed",
  ],
  ["setCommitmentStatus", "setCommitmentStatus", "commitment status changed"],
  ["recordActualCashFlow", "recordActualCashFlow", "actual cash flow recorded"],
  ["deleteFutureCashFlow", "deleteFutureCashFlow", "future cash flow deleted"],
  [
    "createForecastAssumptionSet",
    "createForecastAssumptionSet",
    "forecast assumption set created",
  ],
  [
    "addForecastAssumption",
    "addForecastAssumption",
    "forecast assumption added",
  ],
  [
    "versionForecastAssumptionSet",
    "versionForecastAssumptionSet",
    "forecast assumption set versioned",
  ],
  [
    "deleteForecastAssumption",
    "deleteForecastAssumption",
    "forecast assumption deleted",
  ],
  [
    "addPlannedExpenditure",
    "addPlannedExpenditure",
    "planned expenditure added",
  ],
  ["deleteRecurringFlow", "deleteRecurringFlow", "recurring flow deleted"],
  [
    "deletePlannedExpenditure",
    "deletePlannedExpenditure",
    "planned expenditure deleted",
  ],
  ["materializeFlow", "materializeFlow", "recurring flow materialized"],
  ["setExpectedReturn", "setExpectedReturn", "expected return changed"],
  ["setAccountLiquidity", "setAccountLiquidity", "account liquidity changed"],
  ["setMortgageTerms", "setMortgageTerms", "mortgage terms changed"],
  [
    "setPropertyValueSelection",
    "setPropertyValueSelection",
    "property value selection changed",
  ],
  ["setInflation", "setInflation", "inflation changed"],
  ["setBaseCurrency", "setBaseCurrency", "base currency changed"],
  ["setWithdrawalRate", "setWithdrawalRate", "withdrawal rate changed"],
  ["saveMortgageScenario", "saveMortgageScenario", "mortgage scenario saved"],
  ["createDecisionRecord", "createDecisionRecord", "decision record created"],
  [
    "revisitAdoptedDecision",
    "revisitAdoptedDecision",
    "adopted decision revisited",
  ],
  [
    "recordDecisionObservation",
    "recordDecisionObservation",
    "decision observation recorded",
  ],
  [
    "addDecisionInterpretation",
    "addDecisionInterpretation",
    "decision interpretation added",
  ],
  [
    "saveEmergencyFundPlan",
    "saveEmergencyFundPlan",
    "emergency fund plan saved",
  ],
  ["saveSpendingBaseline", "saveSpendingBaseline", "spending baseline saved"],
  ["saveJobMoveScenario", "saveJobMoveScenario", "job-move scenario saved"],
  [
    "duplicateJobMoveScenario",
    "duplicateJobMoveScenario",
    "job-move scenario duplicated",
  ],
  [
    "deleteJobMoveScenario",
    "deleteJobMoveScenario",
    "job-move scenario deleted",
  ],
  ["setNetWorthTarget", "setNetWorthTarget", "net-worth target changed"],
  ["addHouseholdMember", "addHouseholdMember", "household member added"],
  [
    "renameHouseholdMember",
    "renameHouseholdMember",
    "household member renamed",
  ],
  [
    "setActiveHouseholdScope",
    "setActiveHouseholdScope",
    "household scope changed",
  ],
  ["setAccountOwnership", "setAccountOwnership", "account ownership changed"],
  ["clearData", "clear", "all data cleared"],
  ["restoreBackup", "restoreBackup", "backup restored"],
] as const;

describe("AssetTrackerProvider action facade", () => {
  beforeEach(() => {
    tracker = null;
    adapterState.apiCalls = [];
    adapterState.disposeCalls = 0;
    adapterState.loadCalls = 0;
    adapterState.operations = [];
    adapterState.resetCalls = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards every public mutation through a named adapter operation", async () => {
    const view = renderProvider();
    const actions = getTracker() as unknown as Record<
      string,
      (...arguments_: unknown[]) => unknown
    >;

    await act(async () => {
      for (const [actionName] of commandMappings) {
        const action = actions[actionName];
        if (action == null)
          throw new Error(`Missing provider action: ${actionName}`);
        await action({}, {});
      }
      await getTracker().adoptDecisionForecast({
        decisionIds: ["single-storey-extension"],
        horizonMonths: 36,
        reserveMonths: 6,
      });
      await getTracker().resetData();
    });

    expect(adapterState.operations).toEqual([
      ...commandMappings.map(([, , operation]) => operation),
      "decision forecast adopted",
    ]);
    expect(adapterState.apiCalls).toEqual([
      ...commandMappings.map(([, apiMethod]) => apiMethod),
      "adoptDecisionForecast",
      "reset",
    ]);
    expect(adapterState.resetCalls).toBe(1);

    getTracker().retryLocalData();
    expect(adapterState.loadCalls).toBe(2);
    view.unmount();
    expect(adapterState.disposeCalls).toBe(1);
  });

  it("keeps browser exports and backup previews at the provider boundary", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:asset-tracker-test");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    renderProvider();

    getTracker().downloadBackup();
    getTracker().exportCsv();
    getTracker().exportTaxEstimate();
    const preview = await getTracker().previewBackup({
      text: async () =>
        JSON.stringify(createAssetTrackerBackup(getDemoAssetTrackerData())),
    } as File);

    expect(preview.backup).toBeDefined();
    expect(createObjectUrl).toHaveBeenCalledTimes(3);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(3);
    expect(click).toHaveBeenCalledTimes(3);
  });

  it("selects an explicit stable field set", () => {
    renderProvider();
    const selectSettings = selectAssetTrackerFields(
      "baseCurrency",
      "inflation",
    );

    expect(selectSettings(getTracker())).toEqual({
      baseCurrency: "GBP",
      inflation: 0.025,
    });
  });

  it("rejects consumers mounted outside the project provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<CaptureTracker />)).toThrow(
      "useAssetTracker must be used within an AssetTrackerProvider",
    );
  });
});
