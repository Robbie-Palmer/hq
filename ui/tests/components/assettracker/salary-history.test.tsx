import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useAssetTracker } from "@/components/assettracker/asset-tracker-provider";
import { SalaryCalculationHistory } from "@/components/assettracker/salary-calculation-history";
import { SalaryHistoryImportDrawer } from "@/components/assettracker/salary-history-import-drawer";
import { SalaryHistoryManager } from "@/components/assettracker/salary-history-manager";
import { SalaryRecordDrawer } from "@/components/assettracker/salary-record-drawer";
import {
  readSalaryImportFile,
  type SalaryHistoryRecord,
} from "@/lib/domain/assettracker";

vi.mock("@/components/assettracker/asset-tracker-provider", () => ({
  useAssetTracker: vi.fn(),
}));

vi.mock("@/lib/domain/assettracker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/assettracker")>()),
  readSalaryImportFile: vi.fn(),
}));

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const mockReadSalaryImportFile = vi.mocked(readSalaryImportFile);

beforeAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value: vi.fn(),
    });
  }
});

afterAll(() => {
  for (const method of [
    "setPointerCapture",
    "releasePointerCapture",
    "hasPointerCapture",
  ]) {
    Reflect.deleteProperty(HTMLElement.prototype, method);
  }
});

describe("salary history controls", () => {
  const saveSalaryRecord = vi.fn().mockResolvedValue(undefined);
  const importSalaryHistory = vi.fn().mockResolvedValue(undefined);
  const deleteSalaryRecord = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue({
      household: {
        members: [{ id: "alex", displayName: "Alex" }],
        activeScope: { kind: "household" },
      },
      saveSalaryRecord,
      importSalaryHistory,
      deleteSalaryRecord,
    } as unknown as ReturnType<typeof useAssetTracker>);
  });

  it("adds period pay with pension facts", async () => {
    const user = userEvent.setup();
    render(<SalaryRecordDrawer />);

    await user.click(screen.getByRole("button", { name: "Add manually" }));
    await user.type(screen.getByLabelText("Employer"), "Fieldwork Co-op");
    await user.click(screen.getByText("More details, if you know them"));
    await user.selectOptions(
      screen.getByLabelText("Tax jurisdiction"),
      "England",
    );
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2023-04-01" },
    });
    await user.selectOptions(screen.getByLabelText("Figure covers"), "monthly");
    await user.type(
      screen.getByLabelText("Hours compared with full-time (optional %)"),
      "80",
    );
    await user.type(
      screen.getByLabelText("Gross pay before tax and pension"),
      "3200",
    );
    await user.type(screen.getByLabelText("Base salary"), "3000");
    await user.type(screen.getByLabelText("Variable pay or bonus"), "200");
    const employeePension = screen.getByRole("group", {
      name: "Employee pension",
    });
    await user.selectOptions(
      within(employeePension).getByLabelText("Contribution type"),
      "salarySacrifice",
    );
    await user.selectOptions(
      within(employeePension).getByLabelText("Contribution basis"),
      "grossPay",
    );
    await user.type(within(employeePension).getByLabelText("Rate (%)"), "5");
    await user.click(
      screen.getByRole("button", { name: "Save salary record" }),
    );

    await waitFor(() =>
      expect(saveSalaryRecord).toHaveBeenCalledWith({
        facts: expect.objectContaining({
          person: "Alex",
          employer: "Fieldwork Co-op",
          employmentId: "alex-fieldwork-co-op",
          effectiveStart: "2023-04-01",
          amountKind: "periodPay",
          workFraction: 0.8,
          grossPay: 3_200,
          baseSalary: 3_000,
          variablePay: 200,
          employeePension: {
            arrangement: "salarySacrifice",
            basis: "grossPay",
            effectiveStart: "2023-04-01",
            effectiveEnd: undefined,
            amount: undefined,
            rate: 0.05,
          },
        }),
        correctsId: undefined,
      }),
    );
  });

  it("saves a take-home-only salary record without tax details", async () => {
    const user = userEvent.setup();
    render(<SalaryRecordDrawer />);

    await user.click(screen.getByRole("button", { name: "Add manually" }));
    await user.type(screen.getByLabelText("Employer"), "First job");
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "30/06/2016" },
    });
    await user.selectOptions(
      screen.getByLabelText("Pay figure you know"),
      "take-home",
    );
    await user.type(
      screen.getByLabelText("Take-home pay after tax and pension"),
      "1250",
    );
    await user.click(
      screen.getByRole("button", { name: "Save salary record" }),
    );

    await waitFor(() =>
      expect(saveSalaryRecord).toHaveBeenCalledWith({
        facts: expect.objectContaining({
          person: "Alex",
          employer: "First job",
          employmentId: "alex-first-job",
          effectiveStart: "2016-06-30",
          payFrequency: "monthly",
          amountKind: "periodPay",
          grossPay: undefined,
          takeHomePay: 1_250,
        }),
        correctsId: undefined,
      }),
    );
  });

  it("records a pay rise against an existing employment", async () => {
    const current: SalaryHistoryRecord = {
      id: "salary-current",
      person: "Alex",
      employer: "Fieldwork Co-op",
      employmentId: "alex-fieldwork-co-op",
      currency: "GBP",
      jurisdiction: "England",
      effectiveStart: "2023-04-01",
      payFrequency: "annual",
      amountKind: "annualSalary",
      grossPay: 50_000,
      source: { kind: "manual" },
      acceptedAt: "2025-01-01T00:00:00.000Z",
    };
    mockUseAssetTracker.mockReturnValue({
      household: {
        members: [{ id: "alex", displayName: "Alex" }],
        activeScope: { kind: "household" },
      },
      currentSalaryHistory: [current],
      saveSalaryRecord,
      importSalaryHistory,
      deleteSalaryRecord,
    } as unknown as ReturnType<typeof useAssetTracker>);
    const user = userEvent.setup();
    render(<SalaryRecordDrawer />);

    await user.click(screen.getByRole("button", { name: "Add manually" }));
    await user.selectOptions(
      screen.getByLabelText("What are you recording?"),
      "raise",
    );
    await user.type(screen.getByLabelText("New rate starts"), "01/07/2025");
    const gross = screen.getByLabelText(
      "New gross salary before tax and pension",
    );
    await user.clear(gross);
    await user.type(gross, "55000");
    await user.click(
      screen.getByRole("button", { name: "Save salary record" }),
    );

    await waitFor(() =>
      expect(saveSalaryRecord).toHaveBeenCalledWith({
        facts: expect.objectContaining({
          employer: "Fieldwork Co-op",
          employmentId: "alex-fieldwork-co-op",
          effectiveStart: "2025-07-01",
          grossPay: 55_000,
        }),
        correctsId: undefined,
        replacesRateId: "salary-current",
      }),
    );
  });

  it("keeps employers separate when a correction inherited a stale employment ID", async () => {
    const oldEmployer: SalaryHistoryRecord = {
      id: "salary-old-employer",
      person: "Alex",
      employer: "Old Company",
      employmentId: "alex-old-company",
      currency: "GBP",
      jurisdiction: "England",
      effectiveStart: "2023-04-01",
      effectiveEnd: "2024-06-30",
      payFrequency: "annual",
      amountKind: "annualSalary",
      grossPay: 50_000,
      source: { kind: "manual" },
      acceptedAt: "2025-01-01T00:00:00.000Z",
    };
    const newEmployer: SalaryHistoryRecord = {
      ...oldEmployer,
      id: "salary-new-employer",
      employer: "New Company",
      effectiveStart: "2024-07-01",
      effectiveEnd: undefined,
      grossPay: 60_000,
      acceptedAt: "2025-01-02T00:00:00.000Z",
    };
    mockUseAssetTracker.mockReturnValue({
      household: {
        members: [{ id: "alex", displayName: "Alex" }],
        activeScope: { kind: "household" },
      },
      currentSalaryHistory: [oldEmployer, newEmployer],
      saveSalaryRecord,
      importSalaryHistory,
    } as unknown as ReturnType<typeof useAssetTracker>);
    const user = userEvent.setup();
    render(<SalaryRecordDrawer />);

    await user.click(screen.getByRole("button", { name: "Add manually" }));
    await user.selectOptions(
      screen.getByLabelText("What are you recording?"),
      "raise",
    );
    const employment = screen.getByLabelText("Employment");
    expect(
      within(employment).getByRole("option", { name: "Alex · New Company" }),
    ).toBeVisible();
    expect(
      within(employment).getByRole("option", { name: "Alex · Old Company" }),
    ).toBeVisible();
    await user.selectOptions(employment, "salary-new-employer");
    await user.type(screen.getByLabelText("New rate starts"), "01/07/2025");
    const gross = screen.getByLabelText(
      "New gross salary before tax and pension",
    );
    await user.clear(gross);
    await user.type(gross, "65000");
    await user.click(
      screen.getByRole("button", { name: "Save salary record" }),
    );

    await waitFor(() =>
      expect(saveSalaryRecord).toHaveBeenCalledWith({
        facts: expect.objectContaining({
          employer: "New Company",
          employmentId: "alex-new-company",
          grossPay: 65_000,
        }),
        correctsId: undefined,
        replacesRateId: "salary-new-employer",
      }),
    );
  });

  it("records a one-off bonus without annualising it", async () => {
    const current: SalaryHistoryRecord = {
      id: "salary-current",
      person: "Alex",
      employer: "Fieldwork Co-op",
      employmentId: "alex-fieldwork-co-op",
      currency: "GBP",
      jurisdiction: "England",
      effectiveStart: "2023-04-01",
      payFrequency: "annual",
      amountKind: "annualSalary",
      grossPay: 50_000,
      source: { kind: "manual" },
      acceptedAt: "2025-01-01T00:00:00.000Z",
    };
    mockUseAssetTracker.mockReturnValue({
      household: {
        members: [{ id: "alex", displayName: "Alex" }],
        activeScope: { kind: "household" },
      },
      currentSalaryHistory: [current],
      saveSalaryRecord,
      importSalaryHistory,
    } as unknown as ReturnType<typeof useAssetTracker>);
    const user = userEvent.setup();
    render(<SalaryRecordDrawer />);

    await user.click(screen.getByRole("button", { name: "Add manually" }));
    await user.selectOptions(
      screen.getByLabelText("What are you recording?"),
      "bonus",
    );
    await user.type(screen.getByLabelText("Payment date"), "20/12/2025");
    await user.type(
      screen.getByLabelText("Gross bonus before deductions"),
      "5000",
    );
    await user.click(
      screen.getByRole("button", { name: "Save salary record" }),
    );

    await waitFor(() =>
      expect(saveSalaryRecord).toHaveBeenCalledWith({
        facts: expect.objectContaining({
          employer: "Fieldwork Co-op",
          effectiveStart: "2025-12-20",
          effectiveEnd: "2025-12-20",
          amountKind: "periodPay",
          payFrequency: "irregular",
          grossPay: 5_000,
          variablePay: 5_000,
        }),
        correctsId: undefined,
      }),
    );
  });

  it("starts a new employment identity when a correction changes employer", async () => {
    const record: SalaryHistoryRecord = {
      id: "salary-original",
      person: "Alex",
      employer: "Old Company",
      employmentId: "alex-old-company",
      currency: "GBP",
      jurisdiction: "England",
      effectiveStart: "2024-07-01",
      payFrequency: "annual",
      amountKind: "annualSalary",
      grossPay: 60_000,
      source: { kind: "manual" },
      acceptedAt: "2025-01-01T00:00:00.000Z",
    };
    const user = userEvent.setup();
    render(<SalaryRecordDrawer record={record} />);

    await user.click(screen.getByRole("button", { name: "Correct" }));
    const employer = screen.getByLabelText("Employer");
    await user.clear(employer);
    await user.type(employer, "New Company");
    await user.click(screen.getByRole("button", { name: "Accept correction" }));

    await waitFor(() =>
      expect(saveSalaryRecord).toHaveBeenCalledWith({
        facts: expect.objectContaining({
          employer: "New Company",
          employmentId: "alex-new-company",
        }),
        correctsId: "salary-original",
      }),
    );
  });

  it("submits a correction and reports a save failure", async () => {
    const record: SalaryHistoryRecord = {
      id: "salary-original",
      person: "Alex",
      employer: "Cirrus Systems",
      employmentId: "alex-cirrus",
      currency: "GBP",
      jurisdiction: "UK",
      effectiveStart: "2024-04-01",
      payFrequency: "monthly",
      amountKind: "annualSalary",
      grossPay: 70_000,
      otherTaxableIncome: 0,
      otherDeductions: 0,
      nationalInsuranceCategory: "A",
      isCompanyDirector: false,
      source: { kind: "manual" },
      acceptedAt: "2025-01-01T00:00:00.000Z",
    };
    saveSalaryRecord.mockRejectedValueOnce(new Error("Storage unavailable"));
    const user = userEvent.setup();
    render(<SalaryRecordDrawer record={record} />);

    await user.click(screen.getByRole("button", { name: "Correct" }));
    await user.click(screen.getByText("More details, if you know them"));
    const jurisdiction = screen.getByLabelText("Tax jurisdiction");
    expect(jurisdiction).toBeRequired();
    expect(jurisdiction).toHaveValue("England");
    await user.selectOptions(jurisdiction, "Scotland");
    const gross = screen.getByLabelText("Gross pay before tax and pension");
    await user.clear(gross);
    await user.type(gross, "72000");
    await user.click(screen.getByRole("button", { name: "Accept correction" }));

    await waitFor(() =>
      expect(saveSalaryRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          correctsId: "salary-original",
          facts: expect.objectContaining({
            grossPay: 72_000,
            jurisdiction: "Scotland",
          }),
        }),
      ),
    );
    expect(screen.getByText("Something went wrong")).toBeVisible();
  });

  it("maps and imports a client-side CSV review", async () => {
    mockReadSalaryImportFile.mockResolvedValue({
      fileName: "salary.csv",
      fingerprint: "fixture",
      headers: [
        "person",
        "employer",
        "employment id",
        "currency",
        "jurisdiction",
        "effective start",
        "pay frequency",
        "amount type",
        "gross pay before pension",
      ],
      rows: [
        [
          "Alex",
          "Cirrus Systems",
          "alex-cirrus",
          "GBP",
          "UK",
          "2024-04-01",
          "monthly",
          "annual salary",
          "72000",
        ],
      ],
    });
    const user = userEvent.setup();
    render(<SalaryHistoryImportDrawer />);

    await user.click(
      screen.getByRole("button", { name: "Import salary file" }),
    );
    await user.upload(
      screen.getByLabelText("CSV, TSV, or Excel file"),
      new File(["fixture"], "salary.csv", { type: "text/csv" }),
    );

    expect(await screen.findByText("Review 1 record")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Import 1 record" }));

    await waitFor(() =>
      expect(importSalaryHistory).toHaveBeenCalledWith({
        records: [
          expect.objectContaining({
            person: "Alex",
            grossPay: 72_000,
            source: {
              kind: "file",
              fileName: "salary.csv",
              fingerprint: "fixture",
              row: 2,
            },
          }),
        ],
      }),
    );
  });

  it("shows current salary facts and preserves a superseded source", async () => {
    const original: SalaryHistoryRecord = {
      id: "alex-cirrus-original",
      person: "Alex",
      employer: "Cirrus Systems",
      employmentId: "alex-cirrus",
      currency: "GBP",
      jurisdiction: "UK",
      effectiveStart: "2024-04-01",
      payFrequency: "monthly",
      amountKind: "annualSalary",
      grossPay: 70_000,
      source: {
        kind: "file",
        fileName: "salary.csv",
        fingerprint: "fixture",
        row: 7,
      },
      acceptedAt: "2025-01-01T00:00:00.000Z",
    };
    const corrected: SalaryHistoryRecord = {
      ...original,
      id: "alex-cirrus-corrected",
      grossPay: 72_000,
      baseSalary: 64_000,
      variablePay: 8_000,
      taxablePay: 67_680,
      takeHomePay: 47_300,
      employeePension: {
        arrangement: "salarySacrifice",
        rate: 0.06,
        basis: "grossPay",
      },
      employerPension: {
        arrangement: "other",
        amount: 5_760,
        basis: "grossPay",
      },
      source: { kind: "manual" },
      acceptedAt: "2025-01-02T00:00:00.000Z",
      correctsId: original.id,
    };
    const periodPay: SalaryHistoryRecord = {
      ...original,
      id: "sam-fieldwork-period",
      person: "Sam",
      employer: "Fieldwork Co-op",
      employmentId: "sam-fieldwork",
      effectiveStart: "2023-04-01",
      effectiveEnd: "2023-04-30",
      amountKind: "periodPay",
      workFraction: 0.8,
      grossPay: 3_200,
      source: { kind: "manual" },
      acceptedAt: "2025-01-03T00:00:00.000Z",
    };
    mockUseAssetTracker.mockReturnValue({
      household: {
        members: [{ id: "alex", displayName: "Alex" }],
        activeScope: { kind: "household" },
      },
      salaryHistory: [original, corrected, periodPay],
      currentSalaryHistory: [corrected, periodPay],
      saveSalaryRecord,
      importSalaryHistory,
      deleteSalaryRecord,
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<SalaryHistoryManager />);

    expect(screen.getByText("Salary history")).toBeVisible();
    expect(screen.getAllByText(/£72,000/)).not.toHaveLength(0);
    expect(screen.getAllByText(/£38,400.*annualised/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Employee: 6%/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Employer: 5,760/)).not.toHaveLength(0);
    expect(screen.getAllByText("Manual entry")).not.toHaveLength(0);

    await userEvent.click(screen.getByText("Prior accepted facts"));
    expect(screen.getAllByText("salary.csv, row 7")).not.toHaveLength(0);

    const [deleteButton] = screen.getAllByRole("button", {
      name: "Delete salary record for Cirrus Systems from 2024-04-01",
    });
    if (deleteButton == null) throw new Error("Expected a delete button");
    await userEvent.click(deleteButton);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm deletion of salary record for Cirrus Systems from 2024-04-01",
      }),
    );
    expect(deleteSalaryRecord).toHaveBeenCalledWith({ id: corrected.id });
  });

  it("shows a sourced estimate and observed reconciliation", async () => {
    const record: SalaryHistoryRecord = {
      id: "salary-calculation",
      person: "Alex",
      employer: "Cirrus Systems",
      employmentId: "alex-cirrus",
      currency: "GBP",
      jurisdiction: "England",
      effectiveStart: "2025-04-06",
      effectiveEnd: "2026-04-05",
      payFrequency: "monthly",
      amountKind: "annualSalary",
      grossPay: 60_000,
      takeHomePay: 41_878,
      observedIncomeTax: 9_032,
      observedEmployeeNationalInsurance: 3_090,
      otherTaxableIncome: 0,
      otherDeductions: 0,
      taxCode: "1257L",
      nationalInsuranceCategory: "A",
      isCompanyDirector: false,
      employeePension: {
        arrangement: "salarySacrifice",
        amount: 6_000,
        basis: "grossPay",
      },
      employerPension: { arrangement: "none", basis: "unknown" },
      source: { kind: "manual" },
      acceptedAt: "2026-10-04T10:00:00Z",
    };
    mockUseAssetTracker.mockReturnValue({
      currentSalaryHistory: [record],
    } as unknown as ReturnType<typeof useAssetTracker>);
    const user = userEvent.setup();

    render(<SalaryCalculationHistory />);

    const ready = screen.getByText("Estimate ready");
    expect(ready).toBeVisible();
    expect(ready.closest("summary")).toHaveTextContent(
      "Estimated take-home £41,878.00 per year",
    );
    await user.click(screen.getByText("Alex · Cirrus Systems"));
    expect(screen.getAllByText("Matches")).toHaveLength(3);
    await user.click(screen.getByText("Rules and assumptions"));
    expect(screen.getByText(/Dataset 2026.10.3/)).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: /Rates and thresholds for employers 2025 to 2026/,
      }),
    ).toHaveAttribute("href", expect.stringContaining("gov.uk"));
  });

  it("lists missing salary assumptions instead of calculating with zero", async () => {
    const record: SalaryHistoryRecord = {
      id: "salary-blocked",
      person: "Alex",
      employer: "Cirrus Systems",
      employmentId: "alex-cirrus",
      currency: "GBP",
      jurisdiction: "UK",
      effectiveStart: "2025-04-06",
      effectiveEnd: "2026-04-05",
      payFrequency: "monthly",
      amountKind: "annualSalary",
      grossPay: 60_000,
      source: { kind: "manual" },
      acceptedAt: "2026-10-04T10:00:00Z",
    };
    mockUseAssetTracker.mockReturnValue({
      currentSalaryHistory: [record],
    } as unknown as ReturnType<typeof useAssetTracker>);

    render(<SalaryCalculationHistory />);
    await userEvent.click(screen.getByText("Alex · Cirrus Systems"));

    expect(screen.getByText("Needs input")).toBeVisible();
    expect(screen.getByText(/A generic UK value is not enough/)).toBeVisible();
    expect(screen.getAllByText(/including zero/)).toHaveLength(2);
  });
});
