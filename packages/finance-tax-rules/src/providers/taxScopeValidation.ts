import { z } from "zod";
import {
  isoDateSchema,
  jurisdictionSchema,
  moneyPenceSchema,
  taxYearSchema,
} from "../schema";

export const TAX_SCOPE_VALIDATION_ADAPTER_VERSION = "1.0.0";

const DEFAULT_ENDPOINT = "https://taxscope.uk/api/calculate/paye/";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 100;
const MAX_RETRY_AFTER_MS = 1_000;

export const taxScopeValidationRequestSchema = z
  .object({
    purpose: z.literal("validation-only"),
    dataClassification: z.literal("synthetic"),
    precision: z.literal("annual-liability-estimate"),
    effectiveDate: isoDateSchema,
    taxYear: taxYearSchema,
    jurisdiction: jurisdictionSchema,
    contractualGrossPayPence: moneyPenceSchema.positive(),
    nationalInsuranceCategory: z.literal("A"),
    isCompanyDirector: z.literal(false),
    pension: z.null(),
  })
  .strict()
  .superRefine(({ effectiveDate, taxYear }, context) => {
    const startYear = Number.parseInt(taxYear.slice(0, 4), 10);
    const endYear = startYear + 1;
    const expectedSuffix = String(endYear % 100).padStart(2, "0");
    if (
      taxYear.slice(5) !== expectedSuffix ||
      effectiveDate < `${startYear}-04-06` ||
      effectiveDate > `${endYear}-04-05`
    ) {
      context.addIssue({
        code: "custom",
        message: "Effective date must fall within the stated UK tax year.",
        path: ["effectiveDate"],
      });
    }
  });

export type TaxScopeValidationRequest = z.infer<
  typeof taxScopeValidationRequestSchema
>;

const taxScopeResponseSchema = z.object({
  tax_paid: z.number().nonnegative(),
  ni_paid: z.number().nonnegative(),
  pension_contribution: z.number().nonnegative(),
  take_home: z.number().nonnegative(),
  pension_scheme: z.literal("none"),
  hmrc_region: z.string().trim().min(1),
  hmrc_payroll_frequency: z.literal("annual"),
  hmrc_precision_level: z.string().trim().min(1),
  calculation_mode: z.string().trim().min(1),
  has_result: z.literal(true),
});

export type TaxScopeValidationFailureKind =
  | "invalid-request"
  | "timeout"
  | "network"
  | "rate-limited"
  | "provider-unavailable"
  | "provider-rejected"
  | "provider-error"
  | "invalid-response";

export type TaxScopeValidationResult =
  | {
      ok: true;
      precision: "annual-liability-estimate";
      components: {
        grossCashPayPence: number;
        incomeTaxPence: number;
        employeeNationalInsurancePence: number;
        memberPensionDeductionPence: 0;
        takeHomePayPence: number;
      };
      lineage: {
        adapterId: "taxscope-validation";
        adapterVersion: typeof TAX_SCOPE_VALIDATION_ADAPTER_VERSION;
        providerId: "taxscope";
        providerApiVersion: null;
        providerRuleVersion: null;
        providerContractSnapshot: "taxscope-paye-2026-11-01";
        endpoint: string;
        requestedTaxYear: string;
        providerRegion: string;
        providerCalculationMode: string;
        providerReportedPrecision: string;
        providerResponseDate: string | null;
        evaluatedAt: string;
        responseSha256: string;
      };
    }
  | {
      ok: false;
      failure: {
        kind: TaxScopeValidationFailureKind;
        message: string;
        retryable: boolean;
        attempts: number;
        status: number | null;
      };
    };

type Fetch = typeof fetch;

export type TaxScopeValidationAdapterOptions = {
  endpoint?: string;
  fetch?: Fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  initialBackoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
};

type ResolvedOptions = Required<TaxScopeValidationAdapterOptions>;

type FetchAttempt =
  | { received: true; response: Response }
  | {
      received: false;
      kind: "timeout" | "network";
      message: string;
    };

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const resolveOptions = (
  options: TaxScopeValidationAdapterOptions,
): ResolvedOptions => ({
  endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
  fetch: options.fetch ?? globalThis.fetch,
  timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  initialBackoffMs: options.initialBackoffMs ?? DEFAULT_BACKOFF_MS,
  sleep: options.sleep ?? defaultSleep,
  now: options.now ?? (() => new Date()),
});

const jurisdictionTaxCode = {
  "england-and-northern-ireland": "1257L",
  scotland: "S1257L",
  wales: "C1257L",
} as const;

const poundsToPence = (pounds: number) => Math.round(pounds * 100);

const sha256 = async (value: string) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

const retryableStatus = (status: number) =>
  status === 429 || [502, 503, 504].includes(status);

const retryAfterMilliseconds = (
  response: Response,
  now: Date,
): number | null => {
  const value = response.headers.get("retry-after");
  if (value === null) return null;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - now.valueOf();
  if (!Number.isFinite(delay) || delay < 0) return null;
  return Math.min(delay, MAX_RETRY_AFTER_MS);
};

const failure = (
  kind: TaxScopeValidationFailureKind,
  message: string,
  retryable: boolean,
  attempts: number,
  status: number | null = null,
): TaxScopeValidationResult => ({
  ok: false,
  failure: { kind, message, retryable, attempts, status },
});

const responseFailureKind = (
  status: number,
): TaxScopeValidationFailureKind => {
  if (status === 429) return "rate-limited";
  if ([502, 503, 504].includes(status)) return "provider-unavailable";
  if (status >= 400 && status < 500) return "provider-rejected";
  return "provider-error";
};

const requestBody = (request: TaxScopeValidationRequest) => ({
  tax_year: Number.parseInt(request.taxYear.slice(0, 4), 10),
  income: request.contractualGrossPayPence / 100,
  income_type: "yearly",
  workweek_hours: 40,
  payroll_frequency: "annual",
  tax_code: jurisdictionTaxCode[request.jurisdiction],
  is_scotland: request.jurisdiction === "scotland",
  pension_scheme: "none",
  pension_percent: 0,
});

const validateArithmetic = (
  request: TaxScopeValidationRequest,
  result: z.infer<typeof taxScopeResponseSchema>,
) => {
  const tax = poundsToPence(result.tax_paid);
  const nationalInsurance = poundsToPence(result.ni_paid);
  const takeHome = poundsToPence(result.take_home);
  return (
    result.pension_contribution === 0 &&
    request.contractualGrossPayPence - tax - nationalInsurance === takeHome
  );
};

export class TaxScopeValidationAdapter {
  readonly #options: ResolvedOptions;

  constructor(options: TaxScopeValidationAdapterOptions = {}) {
    this.#options = resolveOptions(options);
    if (this.#options.timeoutMs <= 0) {
      throw new Error("TaxScope timeout must be positive.");
    }
    if (this.#options.maxAttempts < 1 || this.#options.maxAttempts > 2) {
      throw new Error("TaxScope permits one request and at most one retry.");
    }
  }

  async calculate(input: unknown): Promise<TaxScopeValidationResult> {
    if (typeof window !== "undefined") {
      return failure(
        "invalid-request",
        "TaxScope validation requests must run on the server.",
        false,
        0,
      );
    }
    const parsed = taxScopeValidationRequestSchema.safeParse(input);
    if (!parsed.success) {
      return failure(
        "invalid-request",
        parsed.error.issues.map(({ message }) => message).join(" "),
        false,
        0,
      );
    }
    return this.#calculateValidated(parsed.data);
  }

  async #calculateValidated(
    request: TaxScopeValidationRequest,
  ): Promise<TaxScopeValidationResult> {
    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt += 1) {
      const fetched = await this.#fetch(request);
      if (!fetched.received) {
        if (attempt < this.#options.maxAttempts) {
          await this.#waitBeforeRetry(attempt);
          continue;
        }
        return failure(
          fetched.kind,
          fetched.message,
          true,
          attempt,
        );
      }

      const { response } = fetched;
      if (!response.ok) {
        const retryable = retryableStatus(response.status);
        if (retryable && attempt < this.#options.maxAttempts) {
          await this.#waitBeforeRetry(attempt, response);
          continue;
        }
        return failure(
          responseFailureKind(response.status),
          `TaxScope returned HTTP ${response.status}.`,
          retryable,
          attempt,
          response.status,
        );
      }

      return this.#parseResponse(request, response, attempt);
    }

    return failure(
      "provider-error",
      "TaxScope request ended without a result.",
      false,
      this.#options.maxAttempts,
    );
  }

  async #fetch(request: TaxScopeValidationRequest): Promise<FetchAttempt> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#options.timeoutMs,
    );
    try {
      const response = await this.#options.fetch(this.#options.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody(request)),
        cache: "no-store",
        signal: controller.signal,
      });
      return { received: true, response };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      let message = "TaxScope request failed.";
      if (error instanceof Error) message = error.message;
      if (timedOut) {
        message = `TaxScope did not respond within ${this.#options.timeoutMs}ms.`;
      }
      return {
        received: false,
        kind: timedOut ? "timeout" : "network",
        message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async #waitBeforeRetry(attempt: number, response?: Response) {
    const retryAfter =
      response === undefined
        ? null
        : retryAfterMilliseconds(response, this.#options.now());
    await this.#options.sleep(
      retryAfter ?? this.#options.initialBackoffMs * 2 ** (attempt - 1),
    );
  }

  async #parseResponse(
    request: TaxScopeValidationRequest,
    response: Response,
    attempt: number,
  ): Promise<TaxScopeValidationResult> {
    const raw = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return failure(
        "invalid-response",
        "TaxScope returned non-JSON content.",
        false,
        attempt,
        response.status,
      );
    }
    const providerResult = taxScopeResponseSchema.safeParse(json);
    if (
      !providerResult.success ||
      !validateArithmetic(request, providerResult.data)
    ) {
      return failure(
        "invalid-response",
        "TaxScope returned a response that does not satisfy the pinned contract.",
        false,
        attempt,
        response.status,
      );
    }

    return {
      ok: true,
      precision: "annual-liability-estimate",
      components: {
        grossCashPayPence: request.contractualGrossPayPence,
        incomeTaxPence: poundsToPence(providerResult.data.tax_paid),
        employeeNationalInsurancePence: poundsToPence(
          providerResult.data.ni_paid,
        ),
        memberPensionDeductionPence: 0,
        takeHomePayPence: poundsToPence(providerResult.data.take_home),
      },
      lineage: {
        adapterId: "taxscope-validation",
        adapterVersion: TAX_SCOPE_VALIDATION_ADAPTER_VERSION,
        providerId: "taxscope",
        providerApiVersion: null,
        providerRuleVersion: null,
        providerContractSnapshot: "taxscope-paye-2026-11-01",
        endpoint: this.#options.endpoint,
        requestedTaxYear: request.taxYear,
        providerRegion: providerResult.data.hmrc_region,
        providerCalculationMode: providerResult.data.calculation_mode,
        providerReportedPrecision: providerResult.data.hmrc_precision_level,
        providerResponseDate: response.headers.get("date"),
        evaluatedAt: this.#options.now().toISOString(),
        responseSha256: await sha256(raw),
      },
    };
  }
}
