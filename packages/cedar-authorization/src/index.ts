import type * as cedar from "@cedar-policy/cedar-wasm";

export type CedarEngine = Pick<
  typeof cedar,
  "isAuthorized" | "policySetTextToParts" | "policyToJson" | "validate"
>;

export type CedarAuthorizationDecision =
  | { decision: "allow"; determiningPolicies: string[] }
  | {
      decision: "deny";
      reason: "cedar-evaluation-error" | "cedar-policy-deny";
      diagnostics: string[];
    };

export type CedarPolicySet = {
  authorize(
    request: Omit<Parameters<CedarEngine["isAuthorized"]>[0], "policies">,
  ): CedarAuthorizationDecision;
  readonly policyIds: readonly string[];
};

const formatCedarErrors = (
  errors:
    | Array<{ message: string }>
    | Array<{ error: { message: string }; policyId: string }>,
): string[] =>
  errors.map((candidate) =>
    "error" in candidate
      ? `${candidate.policyId}: ${candidate.error.message}`
      : candidate.message,
  );

const evaluationError = (
  diagnostics: string[],
): CedarAuthorizationDecision => ({
  decision: "deny",
  reason: "cedar-evaluation-error",
  diagnostics,
});

export function compileCedarPolicySet(options: {
  readonly engine: CedarEngine;
  readonly label: string;
  readonly policies: string;
  readonly schema: cedar.Schema;
}): CedarPolicySet {
  const { engine, label, policies, schema } = options;
  const policyParts = engine.policySetTextToParts(policies);
  if (policyParts.type === "failure") {
    throw new Error(
      `${label} Cedar policy parse failure: ${formatCedarErrors(policyParts.errors).join("; ")}`,
    );
  }
  if (policyParts.policy_templates.length > 0) {
    throw new Error(`${label} Cedar policies cannot contain templates`);
  }

  const staticPolicies: Record<string, string> = {};
  for (const policyPart of policyParts.policies) {
    const parsedPolicy = engine.policyToJson(policyPart);
    if (parsedPolicy.type === "failure") {
      throw new Error(
        `${label} Cedar policy parse failure: ${formatCedarErrors(parsedPolicy.errors).join("; ")}`,
      );
    }
    const policyId = parsedPolicy.json.annotations?.id;
    if (!policyId) {
      throw new Error(`Every ${label} Cedar policy must have an @id annotation`);
    }
    if (staticPolicies[policyId] !== undefined) {
      throw new Error(`Duplicate ${label} Cedar policy id: ${policyId}`);
    }
    staticPolicies[policyId] = policyPart;
  }

  const validation = engine.validate({
    schema,
    policies: { staticPolicies },
    validationSettings: { mode: "strict" },
  });
  if (validation.type === "failure") {
    throw new Error(
      `${label} Cedar validation failure: ${formatCedarErrors(validation.errors).join("; ")}`,
    );
  }
  const validationDiagnostics = [
    ...formatCedarErrors(validation.validationErrors),
    ...formatCedarErrors(validation.validationWarnings),
    ...formatCedarErrors(validation.otherWarnings),
  ];
  if (validationDiagnostics.length > 0) {
    throw new Error(
      `${label} Cedar validation diagnostics: ${validationDiagnostics.join("; ")}`,
    );
  }

  return {
    policyIds: Object.freeze(Object.keys(staticPolicies)),
    authorize(request) {
      let answer: cedar.AuthorizationAnswer;
      try {
        answer = engine.isAuthorized({
          ...request,
          policies: { staticPolicies },
        });
      } catch (error) {
        return evaluationError([
          error instanceof Error ? error.message : String(error),
        ]);
      }
      if (answer.type === "failure") {
        return evaluationError(formatCedarErrors(answer.errors));
      }
      const diagnostics = [
        ...formatCedarErrors(answer.response.diagnostics.errors),
        ...formatCedarErrors(answer.warnings),
      ];
      if (diagnostics.length > 0) return evaluationError(diagnostics);
      return answer.response.decision === "allow"
        ? {
            decision: "allow",
            determiningPolicies: answer.response.diagnostics.reason,
          }
        : {
            decision: "deny",
            reason: "cedar-policy-deny",
            diagnostics: answer.response.diagnostics.reason,
          };
    },
  };
}
