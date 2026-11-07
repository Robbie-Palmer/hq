import type { Context } from "hono";
import { type ZodType, z } from "zod";

type ValidationDetail = {
  path: Array<string | number>;
  message: string;
};

function detailsFromIssues(issues: z.core.$ZodIssue[]): ValidationDetail[] {
  return issues.map((issue) => ({
    path: issue.path.map((segment) =>
      typeof segment === "symbol" ? segment.toString() : segment,
    ),
    message: issue.message,
  }));
}

export function validationErrorResponse(c: Context, issues: z.core.$ZodIssue[]) {
  return c.json(
    {
      error: "Invalid request body",
      details: detailsFromIssues(issues),
    },
    400,
  );
}

export function invalidJsonResponse(c: Context) {
  return c.json(
    {
      error: "Invalid JSON",
      details: [
        {
          path: [],
          message: "Request body must be valid JSON",
        },
      ],
    },
    400,
  );
}

export function unsupportedMediaTypeResponse(c: Context) {
  return c.json(
    {
      error: "Unsupported media type",
      details: [
        {
          path: [],
          message: "Request body must use application/json",
        },
      ],
    },
    415,
  );
}

function hasJsonContentType(c: Context): boolean {
  const contentType = c.req.header("content-type");
  if (!contentType) return false;
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType);
}

export async function parseJsonBody<TSchema extends ZodType>(
  c: Context,
  schema: TSchema,
): Promise<
  | { success: true; data: z.infer<TSchema> }
  | { success: false; response: Response }
> {
  if (!hasJsonContentType(c)) {
    return {
      success: false,
      response: unsupportedMediaTypeResponse(c),
    };
  }

  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) {
    return {
      success: false,
      response: invalidJsonResponse(c),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      success: false,
      response: validationErrorResponse(c, result.error.issues),
    };
  }
  return { success: true, data: result.data };
}
