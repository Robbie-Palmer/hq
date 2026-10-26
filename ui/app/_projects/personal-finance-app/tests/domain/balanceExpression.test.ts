import { describe, expect, it } from "vitest";
import { evaluateBalanceExpression } from "@/app/_projects/personal-finance-app/domain/balanceExpression";

describe("balance expressions", () => {
  it("evaluates calculator-style arithmetic with standard precedence", () => {
    expect(evaluateBalanceExpression("2648 + 16058")).toBe(18_706);
    expect(evaluateBalanceExpression("(100 + 25) * 2")).toBe(250);
    expect(evaluateBalanceExpression("100 - -25")).toBe(125);
    expect(evaluateBalanceExpression("10 / 4")).toBe(2.5);
  });

  it("uses decimal arithmetic before converting the result to a number", () => {
    expect(evaluateBalanceExpression("0.1 + 0.2")).toBe(0.3);
  });

  it("rejects syntax outside the balance calculator", () => {
    for (const expression of [
      "accountBalance + 1",
      "sqrt(4)",
      "2 ** 8",
      "1 < 2",
      "[1, 2]",
      '"100"',
    ]) {
      expect(() => evaluateBalanceExpression(expression)).toThrow(
        "Use numbers and +, -, *, /, or parentheses",
      );
    }
  });

  it("rejects invalid and unbounded results", () => {
    expect(() => evaluateBalanceExpression("")).toThrow("Enter a balance");
    expect(() => evaluateBalanceExpression("1 +")).toThrow(
      "Use numbers and +, -, *, /, or parentheses",
    );
    expect(() => evaluateBalanceExpression("1 / 0")).toThrow(
      "Division by zero is not allowed",
    );
    expect(() => evaluateBalanceExpression("1e999")).toThrow(
      "This calculation is too large",
    );
  });
});
