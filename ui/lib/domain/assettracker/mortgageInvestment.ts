import {
  afterTaxAndFeesReturn,
  outcomeFor,
  roundMoney,
} from "./mortgageInvestmentSimulation";
import type {
  MortgageInvestmentComparison,
  MortgageInvestmentComparisonInput,
  MortgageInvestmentSensitivity,
} from "./mortgageInvestmentTypes";

export type {
  MortgageInvestmentComparison,
  MortgageInvestmentComparisonInput,
  MortgageInvestmentOutcome,
  MortgageInvestmentPoint,
  MortgageInvestmentSensitivity,
  MortgageInvestmentStrategy,
} from "./mortgageInvestmentTypes";

function compareAtReturn(
  input: MortgageInvestmentComparisonInput,
  investmentReturn: number,
): number {
  const netReturn = afterTaxAndFeesReturn(
    investmentReturn,
    input.investmentAnnualFeeRate,
    input.investmentTaxRate,
  );
  const overpay = outcomeFor(input, "overpay", netReturn, netReturn);
  const invest = outcomeFor(input, "invest", netReturn, netReturn);
  return invest.netWorth - overpay.netWorth;
}

function findBreakEvenReturn(
  input: MortgageInvestmentComparisonInput,
): number | null {
  let low = -0.5;
  let high = 0.5;
  let lowDelta = compareAtReturn(input, low);
  const highDelta = compareAtReturn(input, high);
  if (lowDelta === 0) return low;
  if (highDelta === 0) return high;
  if (Math.sign(lowDelta) === Math.sign(highDelta)) return null;
  for (let iteration = 0; iteration < 24; iteration++) {
    const middle = (low + high) / 2;
    const delta = compareAtReturn(input, middle);
    if (Math.abs(delta) < 0.01) return middle;
    if (Math.sign(delta) === Math.sign(lowDelta)) {
      low = middle;
      lowDelta = delta;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

export function compareMortgageOverpaymentWithInvestment(
  input: MortgageInvestmentComparisonInput,
): MortgageInvestmentComparison {
  const netInvestmentReturn = afterTaxAndFeesReturn(
    input.investmentAnnualReturn,
    input.investmentAnnualFeeRate,
    input.investmentTaxRate,
  );
  const stressedInvestmentReturn = afterTaxAndFeesReturn(
    input.investmentAnnualReturn -
      input.investmentVolatility * input.investmentStressMultiple,
    input.investmentAnnualFeeRate,
    input.investmentTaxRate,
  );
  return {
    input,
    netInvestmentReturn,
    stressedInvestmentReturn,
    overpay: outcomeFor(
      input,
      "overpay",
      netInvestmentReturn,
      stressedInvestmentReturn,
    ),
    invest: outcomeFor(
      input,
      "invest",
      netInvestmentReturn,
      stressedInvestmentReturn,
    ),
    breakEvenInvestmentReturn: findBreakEvenReturn(input),
  };
}

export function buildMortgageInvestmentSensitivity(
  input: MortgageInvestmentComparisonInput,
  mortgageRates: readonly number[],
  investmentReturns: readonly number[],
): MortgageInvestmentSensitivity[] {
  return mortgageRates.flatMap((mortgageRate) =>
    investmentReturns.map((investmentReturn) => {
      const scenario = {
        ...input,
        initialMortgageRate: mortgageRate,
        rateChanges: [],
        investmentAnnualReturn: investmentReturn,
      };
      const netReturn = afterTaxAndFeesReturn(
        investmentReturn,
        input.investmentAnnualFeeRate,
        input.investmentTaxRate,
      );
      const overpay = outcomeFor(scenario, "overpay", netReturn, netReturn);
      const invest = outcomeFor(scenario, "invest", netReturn, netReturn);
      return {
        mortgageRate,
        investmentReturn,
        investNetWorthAdvantage: roundMoney(invest.netWorth - overpay.netWorth),
      };
    }),
  );
}
