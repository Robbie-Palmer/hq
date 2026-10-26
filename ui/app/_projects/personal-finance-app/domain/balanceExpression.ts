import Decimal from "decimal.js";
import jsep from "jsep";

const MAX_EXPRESSION_LENGTH = 100;
const MAX_EXPRESSION_DEPTH = 20;
const DECIMAL_LITERAL = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

const BalanceDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export class BalanceExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalanceExpressionError";
  }
}

function invalidExpression(): never {
  throw new BalanceExpressionError(
    "Use numbers and +, -, *, /, or parentheses",
  );
}

function evaluateLiteral(literal: jsep.Literal): Decimal {
  if (typeof literal.value !== "number" || !DECIMAL_LITERAL.test(literal.raw)) {
    return invalidExpression();
  }
  return new BalanceDecimal(literal.raw);
}

function evaluateUnary(unary: jsep.UnaryExpression, depth: number): Decimal {
  const value = evaluateNode(unary.argument, depth + 1);
  if (unary.operator === "+") return value;
  if (unary.operator === "-") return value.negated();
  return invalidExpression();
}

function evaluateBinary(binary: jsep.BinaryExpression, depth: number): Decimal {
  const left = evaluateNode(binary.left, depth + 1);
  const right = evaluateNode(binary.right, depth + 1);

  switch (binary.operator) {
    case "+":
      return left.plus(right);
    case "-":
      return left.minus(right);
    case "*":
      return left.times(right);
    case "/":
      if (right.isZero()) {
        throw new BalanceExpressionError("Division by zero is not allowed");
      }
      return left.dividedBy(right);
    default:
      return invalidExpression();
  }
}

function evaluateNode(node: jsep.Expression, depth: number): Decimal {
  if (depth > MAX_EXPRESSION_DEPTH) {
    throw new BalanceExpressionError("This calculation is too complex");
  }

  switch (node.type) {
    case "Literal":
      return evaluateLiteral(node as jsep.Literal);
    case "UnaryExpression":
      return evaluateUnary(node as jsep.UnaryExpression, depth);
    case "BinaryExpression":
      return evaluateBinary(node as jsep.BinaryExpression, depth);
    default:
      return invalidExpression();
  }
}

export function evaluateBalanceExpression(source: string): number {
  const expression = source.trim();
  if (expression === "") {
    throw new BalanceExpressionError("Enter a balance");
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new BalanceExpressionError("This calculation is too long");
  }

  let parsed: jsep.Expression;
  try {
    parsed = jsep(expression);
  } catch {
    return invalidExpression();
  }

  let result: number;
  try {
    result = evaluateNode(parsed, 0).toNumber();
  } catch (error) {
    if (error instanceof BalanceExpressionError) throw error;
    return invalidExpression();
  }

  if (!Number.isFinite(result)) {
    throw new BalanceExpressionError("This calculation is too large");
  }
  return Object.is(result, -0) ? 0 : result;
}
