import { render, screen, waitFor, within } from "@testing-library/react";
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
import { useAssetTracker } from "@/app/_projects/personal-finance-app/components/asset-tracker-provider";
import { HmrcStaticImportDrawer } from "@/app/_projects/personal-finance-app/components/hmrc-static-import-drawer";
import {
  type HmrcImportFile,
  readHmrcImportFile,
} from "@/app/_projects/personal-finance-app/domain";

vi.mock(
  "@/app/_projects/personal-finance-app/components/asset-tracker-provider",
  () => ({ useAssetTracker: vi.fn() }),
);

vi.mock(
  "@/app/_projects/personal-finance-app/domain",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/app/_projects/personal-finance-app/domain")
    >()),
    readHmrcImportFile: vi.fn(),
  }),
);

const mockUseAssetTracker = vi.mocked(useAssetTracker);
const mockReadHmrcImportFile = vi.mocked(readHmrcImportFile);
const FINGERPRINT = "a".repeat(64);

function importFile(kind: "income" | "tax", taxYear?: string): HmrcImportFile {
  return {
    kind,
    fileName: `${kind}.json`,
    fingerprint: FINGERPRINT,
    importedAt: "2026-10-31T10:00:00.000Z",
    taxYear,
    employments: [
      {
        payeReference: "123/AB456",
        amount: kind === "income" ? 22_500 : 890.35,
        objectPath:
          kind === "income"
            ? "/employments/0/payFromEmployment"
            : "/employments/0/taxTakenOffPay",
      },
    ],
  };
}

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

describe("HMRC static import drawer", () => {
  const acceptHmrcImport = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetTracker.mockReturnValue({
      acceptHmrcImport,
      hmrcEmploymentObservations: [],
      household: {
        members: [
          { id: "alex", displayName: "Alex" },
          { id: "sam", displayName: "Sam" },
        ],
        activeScope: { kind: "household" },
      },
      salaryHistory: [],
    } as unknown as ReturnType<typeof useAssetTracker>);
    mockReadHmrcImportFile.mockImplementation(async (_file, kind) =>
      importFile(kind),
    );
  });

  it("reviews paired files and accepts observations with a separate manual label", async () => {
    const user = userEvent.setup();
    render(<HmrcStaticImportDrawer />);

    await user.click(
      screen.getByRole("button", { name: "Import saved HMRC responses" }),
    );
    expect(screen.getByText(/never uploads their contents/i)).toBeVisible();
    expect(screen.getByText(/does not contact HMRC/i)).toBeVisible();
    await user.selectOptions(screen.getByLabelText(/Household person/), "sam");
    await user.selectOptions(screen.getByLabelText(/Tax year/), "2024-25");
    await user.upload(
      screen.getByLabelText(/Individual Income 1.2 JSON/),
      new File(["{}"], "income.json", { type: "application/json" }),
    );
    await user.upload(
      screen.getByLabelText(/Individual Tax 1.1 JSON/),
      new File(["{}"], "tax.json", { type: "application/json" }),
    );

    expect(
      await screen.findByText("Review 1 employment observation"),
    ).toBeVisible();
    const table = screen.getByRole("table");
    expect(within(table).getByText("£22,500.00")).toBeVisible();
    expect(within(table).getByText("£890.35")).toBeVisible();
    expect(screen.getByText(/not gross-before-pension salary/i)).toBeVisible();
    expect(screen.getByText("employer identity")).toBeVisible();
    expect(screen.getByText("National Insurance")).toBeVisible();
    expect(screen.getByText("correction identity")).toBeVisible();

    await user.type(
      screen.getByLabelText("Employer label for 123/AB456"),
      "Invented employer",
    );
    await user.click(
      screen.getByRole("button", { name: "Accept 1 observation" }),
    );

    await waitFor(() =>
      expect(acceptHmrcImport).toHaveBeenCalledWith({
        rows: [
          expect.objectContaining({
            memberId: "sam",
            taxYear: "2024-25",
            payeReference: "123/AB456",
            observedTaxablePay: 22_500,
            observedIncomeTax: 890.35,
          }),
        ],
        labels: { "123/AB456": "Invented employer" },
      }),
    );
  });

  it("blocks an enveloped file whose tax year does not match the selection", async () => {
    mockReadHmrcImportFile.mockResolvedValue(importFile("income", "2023-24"));
    const user = userEvent.setup();
    render(<HmrcStaticImportDrawer />);

    await user.click(
      screen.getByRole("button", { name: "Import saved HMRC responses" }),
    );
    await user.selectOptions(screen.getByLabelText(/Tax year/), "2024-25");
    await user.upload(
      screen.getByLabelText(/Individual Income 1.2 JSON/),
      new File(["{}"], "income.json", { type: "application/json" }),
    );

    expect(
      await screen.findByText(/declares tax year 2023-24, not 2024-25/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Accept reviewed observations/ }),
    ).toBeDisabled();
  });
});
