import { describe, expect, it, vi } from "vitest";
import {
  TAX_SCOPE_VALIDATION_ADAPTER_VERSION,
  TaxScopeValidationAdapter,
} from "../../src/providers/taxScopeValidation";

const request = {
  purpose: "validation-only" as const,
  dataClassification: "synthetic" as const,
  precision: "annual-liability-estimate" as const,
  effectiveDate: "2025-06-30",
  taxYear: "2025-26",
  jurisdiction: "england-and-northern-ireland" as const,
  contractualGrossPayPence: 11_000_000,
  nationalInsuranceCategory: "A" as const,
  isCompanyDirector: false as const,
  pension: null,
};

const providerResponse = {
  tax_paid: 33_432,
  ni_paid: 4_210.6,
  pension_contribution: 0,
  take_home: 72_357.4,
  pension_scheme: "none",
  hmrc_region: "rUK",
  hmrc_payroll_frequency: "annual",
  hmrc_precision_level: "approximate",
  calculation_mode: "hmrc_paye",
  has_result: true,
};

describe("TaxScope validation adapter", () => {
  it("refuses to transmit from a browser runtime", async () => {
    const fetch = vi.fn();
    const adapter = new TaxScopeValidationAdapter({ fetch });
    vi.stubGlobal("window", {});

    try {
      const result = await adapter.calculate(request);
      expect(result).toMatchObject({
        ok: false,
        failure: { kind: "invalid-request", attempts: 0, retryable: false },
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses non-synthetic and pension inputs before making a request", async () => {
    const fetch = vi.fn();
    const adapter = new TaxScopeValidationAdapter({ fetch });

    const realData = await adapter.calculate({
      ...request,
      dataClassification: "personal-financial-data",
    });
    const pension = await adapter.calculate({
      ...request,
      pension: { method: "net-pay", grossContributionPence: 600_000 },
    });

    expect(realData).toMatchObject({
      ok: false,
      failure: { kind: "invalid-request", attempts: 0, retryable: false },
    });
    expect(pension).toMatchObject({
      ok: false,
      failure: { kind: "invalid-request", attempts: 0, retryable: false },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns components with explicit missing provider version lineage", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init).toMatchObject({ method: "POST", cache: "no-store" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        tax_year: 2025,
        income: 110_000,
        payroll_frequency: "annual",
        tax_code: "1257L",
        pension_scheme: "none",
        pension_percent: 0,
      });
      return new Response(JSON.stringify(providerResponse), {
        status: 200,
        headers: { date: "Sun, 01 Nov 2026 13:00:00 GMT" },
      });
    });
    const adapter = new TaxScopeValidationAdapter({
      fetch,
      now: () => new Date("2026-11-01T13:00:01Z"),
    });

    const result = await adapter.calculate(request);

    expect(result).toMatchObject({
      ok: true,
      components: {
        grossCashPayPence: 11_000_000,
        incomeTaxPence: 3_343_200,
        employeeNationalInsurancePence: 421_060,
        memberPensionDeductionPence: 0,
        takeHomePayPence: 7_235_740,
      },
      lineage: {
        adapterVersion: TAX_SCOPE_VALIDATION_ADAPTER_VERSION,
        providerApiVersion: null,
        providerRuleVersion: null,
        providerResponseDate: "Sun, 01 Nov 2026 13:00:00 GMT",
        evaluatedAt: "2026-11-01T13:00:01.000Z",
      },
    });
    if (result.ok) {
      expect(result.lineage.responseSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("retries one throttled response and honors a bounded Retry-After", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0.01" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(providerResponse), { status: 200 }),
      );
    const sleep = vi.fn(async () => undefined);
    const adapter = new TaxScopeValidationAdapter({ fetch, sleep });

    const result = await adapter.calculate(request);

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("returns a timeout failure after the single retry", async () => {
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const adapter = new TaxScopeValidationAdapter({
      fetch,
      timeoutMs: 1,
      initialBackoffMs: 0,
    });

    const result = await adapter.calculate(request);

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "timeout", retryable: true, attempts: 2 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rejected tax year or substitute local rules", async () => {
    const fetch = vi.fn(async () =>
      new Response('{"error":"Tax rates not found"}', { status: 404 }),
    );
    const adapter = new TaxScopeValidationAdapter({ fetch });

    const result = await adapter.calculate(request);

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: "provider-rejected",
        message: "TaxScope returned HTTP 404.",
        retryable: false,
        attempts: 1,
        status: 404,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
