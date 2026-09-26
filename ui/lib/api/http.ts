import { isRecord } from "ts-base/records";

export type ApiErrorDetail = {
  code?: string;
  message?: string;
  path?: Array<string | number>;
};

type ApiErrorBody = {
  code?: string;
  details?: ApiErrorDetail[];
  error?: string | { code?: string; message?: string };
  message?: string;
};

export class ApiError extends Error {
  readonly code?: string;
  readonly details?: readonly ApiErrorDetail[];
  readonly status: number;

  constructor(
    message: string,
    status: number,
    options?: {
      code?: string;
      details?: readonly ApiErrorDetail[];
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

type ApiRequestOptions = Omit<RequestInit, "body" | "credentials"> & {
  body?: BodyInit | null;
  fallbackMessage?: string;
  json?: unknown;
  responseType?: "json" | "void";
};

function parseErrorBody(value: unknown): ApiErrorBody | null {
  if (!isRecord(value)) return null;
  const details = Array.isArray(value.details)
    ? value.details.filter(isRecord).map((detail) => ({
        code: typeof detail.code === "string" ? detail.code : undefined,
        message:
          typeof detail.message === "string" ? detail.message : undefined,
        path: Array.isArray(detail.path)
          ? detail.path.filter(
              (part): part is string | number =>
                typeof part === "string" || typeof part === "number",
            )
          : undefined,
      }))
    : undefined;
  const nestedError = isRecord(value.error)
    ? {
        code:
          typeof value.error.code === "string" ? value.error.code : undefined,
        message:
          typeof value.error.message === "string"
            ? value.error.message
            : undefined,
      }
    : undefined;
  return {
    code: typeof value.code === "string" ? value.code : nestedError?.code,
    details,
    error: typeof value.error === "string" ? value.error : nestedError,
    message: typeof value.message === "string" ? value.message : undefined,
  };
}

function detailMessage(detail: ApiErrorDetail): string | undefined {
  if (!detail.message) return undefined;
  const path = detail.path?.join(".");
  return path ? `${path}: ${detail.message}` : detail.message;
}

function errorMessage(body: ApiErrorBody | null, fallback: string): string {
  const details = body?.details
    ?.map(detailMessage)
    .filter((message): message is string => Boolean(message));
  if (details?.length) return details.join("; ");
  if (typeof body?.error === "string") return body.error;
  return body?.error?.message ?? body?.message ?? fallback;
}

async function responseJson(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  if (typeof response.text !== "function") {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isVoidResponse(response: Response, responseType: "json" | "void") {
  return (
    responseType === "void" ||
    response.status === 204 ||
    response.status === 205
  );
}

/**
 * Make a same-origin API request, encoding `json` bodies and normalising API
 * failures into an error callers can branch on by status or code.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("apiRequest only accepts root-relative paths.");
  }
  const {
    body,
    fallbackMessage = "API request failed.",
    headers: initialHeaders,
    json,
    responseType = "json",
    ...requestOptions
  } = options;
  if (body !== undefined && json !== undefined) {
    throw new TypeError("apiRequest accepts either body or json, not both.");
  }

  let headers = initialHeaders;
  let requestBody = body;
  if (json !== undefined) {
    if (initialHeaders === undefined) {
      headers = { "content-type": "application/json" };
    } else {
      const mergedHeaders = new Headers(initialHeaders);
      mergedHeaders.set("content-type", "application/json");
      headers = mergedHeaders;
    }
    requestBody = JSON.stringify(json);
  }

  const response = await fetch(path, {
    ...requestOptions,
    credentials: "same-origin",
    ...(headers !== undefined ? { headers } : {}),
    ...(requestBody !== undefined ? { body: requestBody } : {}),
  });
  const parsed =
    response.ok && responseType === "void"
      ? undefined
      : await responseJson(response);
  if (!response.ok) {
    const errorBody = parseErrorBody(parsed);
    throw new ApiError(
      errorMessage(errorBody, fallbackMessage),
      response.status,
      {
        code: errorBody?.code,
        details: errorBody?.details,
      },
    );
  }
  if (isVoidResponse(response, responseType)) {
    return undefined as T;
  }
  if (parsed === undefined) {
    throw new ApiError(fallbackMessage, response.status);
  }
  return parsed as T;
}
