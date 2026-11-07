import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ForeignExchangeComparison } from "@/app/_projects/personal-finance-app/components/foreign-exchange-comparison";
import { ForeignExchangeDecisionLedger } from "@/app/_projects/personal-finance-app/components/foreign-exchange-decision-ledger";
import { ForeignExchangeDecisionWorkspace } from "@/app/_projects/personal-finance-app/components/foreign-exchange-decision-workspace";
import { useForeignExchangeDecisions } from "@/app/_projects/personal-finance-app/components/use-foreign-exchange-decisions";
import {
  compareForeignExchangeDecision,
  createForeignExchangeDecisionRecord,
  type ForeignExchangeDecisionInput,
  reconcileForeignExchangeDecision,
} from "@/app/_projects/personal-finance-app/domain/foreignExchangeDecision";

function input(): ForeignExchangeDecisionInput {
  return {
    amount: 10_000,
    sourceCurrency: "GBP",
    targetCurrency: "EUR",
    comparedAt: "2026-10-31T10:00:00Z",
    referenceRate: {
      rate: 1.2,
      source: {
        provider: "Reference provider",
        label: "GBP/EUR reference snapshot",
        url: "https://reference.example/rates/gbp-eur",
        observedAt: "2026-10-31T09:45:00Z",
      },
    },
    providerQuote: {
      rate: 1.176,
      fixedFee: 5,
      percentageFee: 0.5,
      source: {
        provider: "Conversion provider",
        label: "Transfer quote Q-123",
        url: "https://quote.example/Q-123",
        observedAt: "2026-10-31T09:50:00Z",
      },
    },
    futureRate: 1.23,
    stressRate: 1.1,
    stagedNowPercentage: 40,
  };
}

function fillWorkspaceInputs() {
  fireEvent.change(screen.getByLabelText("Amount"), {
    target: { value: "10000" },
  });
  fireEvent.change(screen.getByLabelText("Compared at"), {
    target: { value: "2026-10-31T10:00" },
  });
  const rates = screen.getAllByLabelText("Rate");
  fireEvent.change(rates[0] as HTMLElement, { target: { value: "1.2" } });
  fireEvent.change(rates[1] as HTMLElement, { target: { value: "1.176" } });
  const observedAt = screen.getAllByLabelText("Observed at");
  fireEvent.change(observedAt[0] as HTMLElement, {
    target: { value: "2026-10-31T09:45" },
  });
  fireEvent.change(observedAt[1] as HTMLElement, {
    target: { value: "2026-10-31T09:50" },
  });
  const providers = screen.getAllByLabelText("Provider");
  fireEvent.change(providers[0] as HTMLElement, {
    target: { value: "Reference provider" },
  });
  fireEvent.change(providers[1] as HTMLElement, {
    target: { value: "Conversion provider" },
  });
  const labels = screen.getAllByLabelText("Source label or quote ID");
  fireEvent.change(labels[0] as HTMLElement, {
    target: { value: "GBP/EUR reference snapshot" },
  });
  fireEvent.change(labels[1] as HTMLElement, {
    target: { value: "Transfer quote Q-123" },
  });
  const urls = screen.getAllByLabelText("Source URL");
  fireEvent.change(urls[0] as HTMLElement, {
    target: { value: "https://reference.example/rates/gbp-eur" },
  });
  fireEvent.change(urls[1] as HTMLElement, {
    target: { value: "https://quote.example/Q-123" },
  });
  fireEvent.change(screen.getByLabelText("Fixed fee, source currency"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("Percentage fee"), {
    target: { value: "0.5" },
  });
  fireEvent.change(screen.getByLabelText("Future rate assumption"), {
    target: { value: "1.23" },
  });
  fireEvent.change(screen.getByLabelText("Stress rate assumption"), {
    target: { value: "1.1" },
  });
  fireEvent.change(screen.getByLabelText("Convert now in staged case, %"), {
    target: { value: "40" },
  });
}

describe("ForeignExchangeDecisionWorkspace", () => {
  it("builds the comparison from sourced rates and user assumptions", () => {
    localStorage.clear();
    render(<ForeignExchangeDecisionWorkspace />);
    fillWorkspaceInputs();

    fireEvent.click(
      screen.getByRole("button", { name: "Compare conversion cases" }),
    );

    expect(screen.getByText("Conversion comparison")).toBeVisible();
    expect(
      screen.getByText("Reference provider, GBP/EUR reference snapshot"),
    ).toBeVisible();
    expect(screen.getByRole("cell", { name: "€11,695.32" })).toBeVisible();
  });

  it("rejects a same-currency comparison in the form", () => {
    render(<ForeignExchangeDecisionWorkspace />);
    fillWorkspaceInputs();
    fireEvent.change(screen.getByLabelText("Target currency"), {
      target: { value: "GBP" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Compare conversion cases" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Conversion currencies must differ",
    );
    expect(screen.queryByText("Conversion comparison")).not.toBeInTheDocument();
  });
});

describe("ForeignExchangeComparison", () => {
  it("shows source lineage, assumptions, costs, and break-even rates", () => {
    render(
      <ForeignExchangeComparison
        comparison={compareForeignExchangeDecision(input())}
        onSave={() => true}
      />,
    );

    expect(
      screen.getByText(/available quote is 10 minutes old/i),
    ).toBeVisible();
    expect(
      screen.getByText("Reference provider, GBP/EUR reference snapshot"),
    ).toBeVisible();
    expect(
      screen.getByText("Conversion provider, Transfer quote Q-123"),
    ).toBeVisible();
    expect(screen.getByRole("cell", { name: "€11,695.32" })).toBeVisible();
    expect(screen.getAllByText("Assumption")).toHaveLength(4);
    expect(
      screen.getByText(/future and stress rates are your assumptions/i),
    ).toBeVisible();
  });

  it("saves the chosen case with the full input snapshot", async () => {
    const onSave = vi.fn().mockReturnValue(true);
    render(
      <ForeignExchangeComparison
        comparison={compareForeignExchangeDecision(input())}
        onSave={onSave}
      />,
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Chosen conversion case" }),
      "staged-future",
    );
    await userEvent.type(
      screen.getByLabelText("Rationale"),
      "Split the timing risk across two provider transfers.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save decision assumptions" }),
    );

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedScenarioId: "staged-future",
        rationale: "Split the timing risk across two provider transfers.",
        assumptions: expect.objectContaining({
          futureRate: 1.23,
          stressRate: 1.1,
        }),
      }),
    );
  });
});

describe("ForeignExchangeDecisionLedger", () => {
  it("collects the completed conversion for reconciliation", async () => {
    const comparison = compareForeignExchangeDecision(input());
    const record = createForeignExchangeDecisionRecord({
      id: "fx-record",
      savedAt: "2026-10-31T10:05:00Z",
      selectedScenarioId: "now",
      rationale: "Use the available quote.",
      comparison,
    });
    const onReconcile = vi.fn().mockReturnValue(true);
    render(
      <ForeignExchangeDecisionLedger
        records={[record]}
        onReconcile={onReconcile}
      />,
    );

    await userEvent.type(
      screen.getByLabelText("Completed at"),
      "2026-11-01T12:00",
    );
    await userEvent.type(
      screen.getByLabelText("Source amount converted"),
      "10000",
    );
    await userEvent.type(
      screen.getByLabelText("Target amount received"),
      "11700",
    );
    await userEvent.type(
      screen.getByLabelText("Settlement note"),
      "Provider transfer settled.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reconcile completed conversion" }),
    );

    expect(onReconcile).toHaveBeenCalledWith(
      "fx-record",
      expect.objectContaining({
        sourceAmount: 10_000,
        targetAmount: 11_700,
        sourceFees: 0,
        note: "Provider transfer settled.",
      }),
    );
  });

  it("shows the actual rate and proceeds variance after settlement", () => {
    const comparison = compareForeignExchangeDecision(input());
    const record = createForeignExchangeDecisionRecord({
      id: "fx-record",
      savedAt: "2026-10-31T10:05:00Z",
      selectedScenarioId: "now",
      rationale: "Use the available quote.",
      comparison,
    });
    const reconciled = reconcileForeignExchangeDecision(record, {
      completedAt: "2026-11-01T12:00:00Z",
      sourceAmount: 10_000,
      targetAmount: 11_700,
      sourceFees: 50,
      note: "Provider transfer settled.",
    });

    render(
      <ForeignExchangeDecisionLedger
        records={[reconciled]}
        onReconcile={() => true}
      />,
    );

    expect(screen.getByText("Reconciled")).toBeVisible();
    expect(screen.getByText("1.175879")).toBeVisible();
    expect(screen.getByText("€4.68")).toBeVisible();
    expect(screen.getByText("Provider transfer settled.")).toBeVisible();
  });
});

describe("useForeignExchangeDecisions", () => {
  it("persists the assumption snapshot and later reconciliation", async () => {
    localStorage.clear();
    const comparison = compareForeignExchangeDecision(input());
    const record = createForeignExchangeDecisionRecord({
      id: "fx-persisted",
      savedAt: "2026-10-31T10:05:00Z",
      selectedScenarioId: "delay-future",
      rationale: "Wait until the planned payment date.",
      comparison,
    });
    const first = renderHook(useForeignExchangeDecisions);

    act(() => {
      expect(first.result.current.save(record)).toBe(true);
    });
    expect(localStorage.getItem("assettracker:fx-decisions:v1")).toContain(
      "delay-future",
    );
    first.unmount();

    const restored = renderHook(useForeignExchangeDecisions);
    await waitFor(() =>
      expect(restored.result.current.records).toHaveLength(1),
    );
    act(() => {
      expect(
        restored.result.current.reconcile("fx-persisted", {
          completedAt: "2026-11-02T12:00:00Z",
          sourceAmount: 10_000,
          targetAmount: 11_800,
          sourceFees: 55,
          note: "Provider transfer settled.",
        }),
      ).toBe(true);
    });

    expect(restored.result.current.records[0]?.reconciliation).toEqual(
      expect.objectContaining({ targetAmount: 11_800 }),
    );
  });
});
