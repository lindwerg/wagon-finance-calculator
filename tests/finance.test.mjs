import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, numericInputKeys, calculate, minimumMarkup, compareScenarios } from '../finance.mjs';

const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `Ожидалось ${expected}, получено ${actual}`);
};
const day = (result, at) => result.timeline.find((event) => event.day === at);
const base = { clientDays: 45, fundingLimit: 200000 };

test('defaults are complete, immutable, and contain a real zero funding limit', () => {
  assert.equal(DEFAULTS.fundingLimit, 0);
  assert.equal(DEFAULTS.factorConfirmed, false);
  assert.equal(DEFAULTS.factorUnavailable, false);
  assert.ok(Object.isFrozen(DEFAULTS));
  assert.deepEqual(numericInputKeys, Object.keys(DEFAULTS).filter((key) => typeof DEFAULTS[key] === 'number'));
  const result = calculate();
  assert.equal(result.executionReady, false);
  assert.equal(result.uncoveredGap, 100000);
});

test('credit pricing modes validate rates, minimum months and separately owned repayment money', () => {
  assert.equal(DEFAULTS.fundingInterestMode, 'annual_daily');
  assert.equal(DEFAULTS.fundingMonthlyRate, 2);
  assert.equal(DEFAULTS.fundingMonthlyBase, 'balance');
  assert.equal(DEFAULTS.fundingMinimumMonths, 1);
  for (const input of [{ fundingInterestMode: 'monthly' }, { fundingMonthlyBase: 'limit' },
    { fundingCloseMode: 'early' }, { fundingTermMonths: 0 }, { fundingTermMonths: 121 }, { fundingTermMonths: 1.5 },
    { fundingMonthlyRate: -1 }, { fundingMonthlyRate: 1001 }, { fundingMonthlyRate: Infinity },
    { fundingMinimumMonths: 0 }, { fundingMinimumMonths: 121 }, { fundingMinimumMonths: 1.5 },
    { fundingPrincipalMonthly: -1 }, { fundingRepaymentReserve: NaN }]) {
    assert.throws(() => calculate(input), RangeError);
  }
});

test('a monthly principal instalment needs its own reserve without double counting principal as expense', () => {
  const input = { ...base, fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000 };
  const conditional = calculate(input);
  assert.equal(conditional.creditInterest, 3600);
  assert.equal(conditional.creditPricing.principalRepaid, 20000);
  assert.equal(conditional.creditPricing.repaymentReserveGap, 22000);
  assert.equal(conditional.uncoveredGap, 0);
  assert.equal(conditional.peakFundingNeed, 100000);
  assert.equal(conditional.executionReady, false);
  assert.match(conditional.warnings.find(warning => warning.code === 'REPAYMENT_RESERVE_GAP').message,
    /погашение тела кредита не уменьшает прибыль/);
  close(conditional.profit, 5000 / 1.22 - 3600 - 515000 / 1200);
  close(conditional.closingCashAfterInterest, 5000 - 3600);
  const funded = calculate({ ...input, fundingRepaymentReserve: 22000 });
  assert.equal(funded.executionReady, true);
  assert.equal(funded.creditPricing.repaymentReserveGap, 0);
  assert.equal(funded.profit, conditional.profit);
  assert.equal(funded.closingCashAfterInterest, conditional.closingCashAfterInterest);
});

test('monthly interest is due before customer payment even without principal instalments', () => {
  for (const mode of ['monthly_daily', 'monthly_full']) {
    const result = calculate({ ...base, fundingInterestMode: mode, fundingPrincipalMonthly: 0 });
    assert.equal(result.creditPricing.repaymentsBeforeClient, 2000);
    assert.equal(result.creditPricing.repaymentReserveGap, 2000);
    assert.equal(result.executionReady, false);
    assert.equal(calculate({ ...base, fundingInterestMode: mode, fundingRepaymentReserve: 2000 }).executionReady, true);
  }
  assert.equal(calculate(base).creditPricing.repaymentReserveGap, 0);
  assert.equal(calculate(base).executionReady, true);
});

test('factor reduces the next credit balance and caps principal while subscriptions stay outside trade cash', () => {
  const input = { ...base, factorEnabled: true, factorConfirmed: true, factorUpfront: false,
    fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000, fundingRepaymentReserve: 2250 };
  const result = calculate(input);
  assert.equal(result.creditInterest, 2000);
  assert.equal(result.creditPricing.principalRepaid, 250);
  assert.deepEqual(result.creditPricing.repaymentSchedule,
    [{ day: 30, principal: 250, interest: 2000, total: 2250 }]);
  assert.equal(result.executionReady, true);
  const fees = calculate({ ...input, fundingMonthly: 12000, factorMonthly: 6000 });
  assert.deepEqual(fees.creditPricing, result.creditPricing);
  assert.deepEqual(fees.timeline, result.timeline);
  close(result.profit - fees.profit, 15);
});

test('monthly target pricing uses interest as an expense and reserves only for readiness', () => {
  const input = { ...base, fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000 };
  const quote = minimumMarkup(input, 2000);
  assert.ok(quote);
  const result = calculate({ ...input, markup: quote.markup });
  assert.ok(result.profit >= 2000);
  assert.ok(calculate({ ...input, markup: quote.markup - 10 }).profit < 2000);
  assert.equal(result.creditPricing.repaymentReserveGap, 22000);
  assert.equal(result.executionReady, false);
  const funded = calculate({ ...input, markup: quote.markup, fundingRepaymentReserve: 22000 });
  assert.equal(funded.profit, result.profit);
  assert.equal(funded.executionReady, true);
});

test('scheduled credit treats factoring as a payment source while keeping all contracted loan interest', () => {
  const input = { ...base, markup: 10000, fundingCloseMode: 'scheduled',
    fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000, fundingTermMonths: 3 };
  const plain = calculate(input);
  assert.equal(plain.creditInterest, 4800);
  assert.equal(plain.creditPricing.repaymentReserveGap, 22000);
  assert.equal(plain.executionReady, false);
  const factor = calculate({ ...input, factorEnabled: true, factorConfirmed: true, factorUpfront: false });
  assert.equal(factor.creditInterest, plain.creditInterest);
  assert.equal(factor.creditPricing.repaymentReserveGap, 0);
  assert.equal(factor.executionReady, true);
  close(plain.profit - factor.profit, factor.factorFeeNet);
  assert.equal(factor.creditPricing.repaymentSchedule[0].principal, 20000);
  assert.equal(factor.creditPricing.repaymentSchedule.at(-1).principal, 60000);
});

test('early customer receipt does not cancel scheduled interest and fixed fees remain independent', () => {
  const input = { ...base, markup: 10000, clientDays: 7, fundingCloseMode: 'scheduled',
    fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000, fundingTermMonths: 3 };
  const result = calculate(input);
  assert.equal(result.creditInterest, 4800);
  assert.equal(result.creditPricing.repaymentReserveGap, 0);
  assert.equal(result.executionReady, true);
  const fees = calculate({ ...input, fundingMonthly: 12000 });
  assert.deepEqual(fees.creditPricing, result.creditPricing);
  close(result.profit - fees.profit, 10);
  assert.equal(calculate({ ...input, fundingKind: 'none' }).creditInterest, 0);
});

test('minimum markup remains the first ten-ruble price across amortisation thresholds', () => {
  const input = { fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000,
    clientDays: 75, advancePercent: 30, ownCash: 15000 };
  const quote = minimumMarkup(input, 2000);
  assert.equal(quote.markup, 5410);
  assert.ok(quote.profit >= 2000);
  assert.ok(calculate({ ...input, markup: 5400 }).profit < 2000);
});

test('minimum target prices remain minimal with both loan closing modes, factoring and insurance', () => {
  for (const fundingCloseMode of ['on_client', 'scheduled']) {
    for (const fundingInterestMode of ['monthly_full', 'monthly_daily']) {
      for (const insuranceEnabled of [false, true]) {
        for (const fundingPrincipalMonthly of [500, 20000, 80000]) {
          for (const factorEnabled of [false, true]) {
            const input = { fundingCloseMode, fundingInterestMode, insuranceEnabled,
              fundingPrincipalMonthly, factorEnabled, clientDays: 75, advancePercent: 30,
              ownCash: 15000, fundingTermMonths: 4 };
            const quote = minimumMarkup(input, 2000);
            assert.ok(quote, JSON.stringify(input));
            assert.ok(quote.profit >= 2000, JSON.stringify(input));
            assert.ok(calculate({ ...input, markup: quote.markup - 10 }).profit < 2000,
              JSON.stringify({ input, quote }));
          }
        }
      }
    }
  }
});

test('flat upfront monthly credit checks the gross loan against limit and product maximum', () => {
  const input = { ...base, markup: 20000, fundingInterestMode: 'monthly_full', fundingMonthlyRate: 2.49,
    fundingMonthlyBase: 'initial', fundingMonthlyUpfront: true, fundingCloseMode: 'scheduled',
    fundingPrincipalMode: 'equal', fundingTermMonths: 3, fundingLoanMin: 50000, fundingLoanMax: 27510000,
    fundingLimit: 100000, fundingRepaymentReserve: 50000 };
  const result = calculate(input);
  close(result.peakBankLoan, 100000 / 0.9751);
  assert.equal(result.peakFundingNeed, 100000);
  close(result.uncoveredGap, result.peakBankLoan - 100000);
  assert.equal(result.executionReady, false);
  const funded = calculate({ ...input, fundingLimit: 200000 });
  assert.equal(funded.executionReady, true);
  const overMaximum = calculate({ ...input, fundingLimit: 200000, fundingLoanMax: 102000 });
  assert.equal(overMaximum.executionReady, false);
  assert.ok(overMaximum.warnings.some(warning => warning.code === 'LOAN_MAX_EXCEEDED'));
});

test('first upfront commission is an expense exactly once and principal is never a second expense', () => {
  const input = { ...base, markup: 20000, fundingInterestMode: 'monthly_full', fundingMonthlyRate: 2.49,
    fundingMonthlyBase: 'initial', fundingMonthlyUpfront: true, fundingCloseMode: 'scheduled',
    fundingPrincipalMode: 'equal', fundingTermMonths: 3, fundingRepaymentReserve: 50000 };
  const result = calculate(input);
  close(result.creditInterest, result.creditPricing.firstFee * 3);
  close(result.profit, 20000 / 1.22 - result.creditPricing.firstFee * 3 - 515000 / 1200);
  assert.equal(result.breakdown.fundingSetup, 0);
  assert.equal(result.creditPricing.repaymentSchedule.at(-1).interest, 0);
  const fee = calculate({ ...input, fundingFeeFixed: 1000 });
  close(fee.creditPricing.amount, 101000 / 0.9751);
  assert.equal(fee.breakdown.fundingSetup, 1000);
});

test('unconfirmed early repayment cannot make a conditional low price execution ready', () => {
  const input = { ...base, clientDays: 7, fundingEarlyConfirmed: false };
  const result = calculate(input);
  assert.equal(result.executionReady, false);
  assert.ok(result.warnings.some(warning => warning.code === 'EARLY_REPAYMENT_UNCONFIRMED'));
  assert.equal(calculate({ ...input, fundingEarlyConfirmed: true }).executionReady, true);
  assert.equal(calculate({ ...input, fundingCloseMode: 'scheduled', markup: 10000 }).executionReady, true);
});

test('intermediate trade cash shortage after bank payments blocks execution despite funded due dates', () => {
  const input = { fundingCloseMode: 'scheduled', fundingInterestMode: 'monthly_full',
    fundingPrincipalMonthly: 20000, fundingTermMonths: 3, fundingFeeFixed: 20000,
    supplierDay: 50, clientDays: 80, factorEnabled: true, factorConfirmed: true,
    acceptanceDay: 55, factorAdvancePercent: 95, factorRate: 0, fundingLimit: 200000, markup: 30000 };
  const result = calculate(input);
  assert.equal(result.creditPricing.repaymentReserveGap, 0);
  assert.equal(result.creditPricing.tradeFundingGap, 22400);
  assert.equal(result.executionReady, false);
  assert.ok(result.warnings.some(warning => warning.code === 'SCHEDULE_TRADE_GAP'));
  assert.equal(calculate({ ...input, fundingRepaymentReserve: 22400 }).executionReady, true);
});

test('minimum target price inspects the profitable grid immediately before a first-draw clock change', () => {
  const input = { fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 5000,
    fundingMinimumMonths: 3, clientDays: 75, supplierDay: 40, advancePercent: 20,
    insuranceEnabled: true, insurancePercent: 2, fundingFeeFixed: 50000, monthlyOverhead: 0 };
  const quote = minimumMarkup(input, 85000);
  assert.equal(quote.markup, 176210);
  assert.ok(quote.profit >= 85000);
  assert.ok(calculate({ ...input, markup: 176200 }).profit < 85000);
});

test('minimum target price includes offsets between debt events and prior principal caps', () => {
  const input = { fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000,
    fundingMinimumMonths: 1, clientDays: 75, supplierDay: 50, acceptanceDay: 40,
    fundingFeeFixed: 2000, monthlyOverhead: 0, factorEnabled: true,
    factorAdvancePercent: 60, factorUpfront: false, factorRate: 0, factorFeePercent: 100,
    fundingMonthlyRate: 20 };
  const quote = minimumMarkup(input, -112500);
  assert.equal(quote.markup, 31850);
  assert.ok(quote.profit >= -112500);
  assert.ok(calculate({ ...input, markup: 31840 }).profit < -112500);
});

test('unconfirmed principal schedule blocks execution while keeping contracted commissions unchanged', () => {
  const input = { ...base, markup: 20000, fundingInterestMode: 'monthly_full', fundingMonthlyRate: 2.49,
    fundingMonthlyBase: 'initial', fundingMonthlyUpfront: true, fundingCloseMode: 'scheduled',
    fundingPrincipalMode: 'equal', fundingTermMonths: 3, fundingRepaymentReserve: 50000 };
  const confirmed = calculate(input);
  const conditional = calculate({ ...input, fundingScheduleConfirmed: false });
  assert.equal(confirmed.executionReady, true);
  assert.equal(conditional.executionReady, false);
  assert.equal(conditional.creditInterest, confirmed.creditInterest);
  assert.ok(conditional.warnings.some(warning => warning.code === 'SCHEDULE_UNCONFIRMED'));
});

test('minimum target price inspects the new slope at the minimum issuance amount', () => {
  const input = { fundingCloseMode: 'scheduled', fundingInterestMode: 'monthly_full',
    fundingMonthlyBase: 'initial', fundingMonthlyRate: 1000, fundingTermMonths: 1,
    fundingLoanMin: 50000, ownCash: 100000, insuranceEnabled: true,
    insurancePercent: 10, monthlyOverhead: 0 };
  const quote = minimumMarkup(input, -230000);
  assert.equal(quote.markup, 389070);
  assert.ok(quote.profit >= -230000);
  assert.ok(calculate({ ...input, markup: 389060 }).profit < -230000);
});

test('no borrowing ignores monthly upfront mechanics and confirmed banking schedule constraints', () => {
  const result = calculate({ fundingKind: 'none', ownCash: 200000,
    fundingInterestMode: 'monthly_daily', fundingMonthlyUpfront: true,
    fundingCloseMode: 'scheduled', fundingScheduleConfirmed: false, fundingEarlyConfirmed: false,
    fundingLoanMin: 50000, fundingLoanMax: 100000 });
  assert.equal(result.creditInterest, 0);
  assert.equal(result.creditPricing.amount, 0);
  assert.equal(result.creditPricing.firstFee, 0);
  assert.equal(result.executionReady, true);
});

test('annual revolving line keeps daily credit economics and separate target prices for factoring', () => {
  const input = { ...DEFAULTS, fundingKind: 'line', clientDays: 30, fundingRate: 23.5 };
  const line = calculate(input);
  const credit = calculate({ ...input, fundingKind: 'credit' });
  assert.equal(line.creditInterest, credit.creditInterest);
  assert.equal(line.profit, credit.profit);
  const plain = minimumMarkup(input, 2000);
  const factor = minimumMarkup({ ...input, factorEnabled: true }, 2000);
  assert.equal(plain.markup, 5330);
  assert.equal(factor.markup, 5140);
  assert.ok(calculate({ ...input, markup: 5320 }).profit < 2000);
  assert.ok(calculate({ ...input, factorEnabled: true, markup: 5130 }).profit < 2000);
});

test('manual 45-day credit example separates gross markup, VAT, interest, and overhead', () => {
  const result = calculate(base);
  close(result.creditInterest, 100000 * 0.235 * 45 / 365);
  close(result.profit, 771.9337150984368);
  close(result.vatOnMarkup, 5000 - 5000 / 1.22);
  close(result.overheadPerWagon, 515000 / 1200);
  close(result.monthlyExpectedProfit, result.profit * 1200);
  assert.equal(result.financingRublesDays, 4500000);
  assert.equal(result.initialFundingNeed, 100000);
  assert.equal(result.peakFundingNeed, 100000);
  assert.equal(result.closingDebt, 0);
  assert.equal(result.executionReady, true);
});

test('insurance premium is once from the whole invoice, not an annual rate', () => {
  const result = calculate({ ...base, insuranceEnabled: true });
  const withoutInsurance = calculate(base);
  assert.equal(result.breakdown.insurance, 525);
  close(result.creditInterest, 100525 * 0.235 * 45 / 365);
  // The earlier 246.93 benchmark subtracts the premium but does not finance it.
  close(withoutInsurance.profit - 525, 246.9337150984368);
  close(withoutInsurance.profit - result.profit, 525 + 525 * 0.235 * 45 / 365);
  close(result.profit, 5000 / 1.22 - 525 - 515000 / 1200 - 100525 * 0.235 * 45 / 365);
  close(result.profit, 231.7230986600798); // Also finances the premium paid on day zero.
  const short = calculate({ ...base, clientDays: 7, insuranceEnabled: true });
  assert.equal(short.breakdown.insurance, 525);
});

test('manual deferred-factor example finances only the residual 250 rubles', () => {
  const result = calculate({ ...base, factorEnabled: true, factorUpfront: false, factorConfirmed: true });
  assert.equal(result.factorAdvance, 99750);
  assert.equal(result.factorDay, 20);
  assert.equal(result.factorDays, 25);
  assert.equal(result.financingRublesDays, 100000 * 20 + 250 * 25);
  close(result.creditInterest, (100000 * 20 + 250 * 25) * 0.235 / 365);
  close(result.factorFeeNet, 105000 * 0.17 * 25 / 365);
  close(result.profit, 1154.8960438655605);
  assert.equal(result.executionReady, true);
  assert.equal(day(result, 20).loanNeed, 250);
});

test('upfront factor fee lowers payout and increases credit interest', () => {
  const deferred = calculate({ ...base, factorEnabled: true, factorUpfront: false });
  const upfront = calculate({ ...base, factorEnabled: true, factorUpfront: true });
  close(day(upfront, 20).cash, 99750 - upfront.factorFeeGross);
  close(upfront.creditInterest - deferred.creditInterest,
    upfront.factorFeeGross * 0.235 * 25 / 365);
  close(upfront.closingCashAfterInterest, 5000 - upfront.factorFeeGross - upfront.creditInterest);
});

test('factor payout greater than purchase produces no negative loan or interest', () => {
  const result = calculate({ ...base, purchase: 50000, factorEnabled: true, factorUpfront: false });
  assert.equal(result.factorAdvance, 52250);
  assert.equal(day(result, 20).loanNeed, 0);
  close(result.creditInterest, 50000 * 0.235 * 20 / 365);
  assert.equal(result.financingRublesDays, 1000000);
});

test('a positive economic profit without funding still has an uncovered cash gap', () => {
  const result = calculate({ ...base, fundingKind: 'none', fundingLimit: 1000000 });
  assert.equal(result.creditInterest, 0);
  assert.ok(result.profit > 0);
  assert.equal(result.peakFundingNeed, 100000);
  assert.equal(result.uncoveredGap, 100000);
  assert.equal(result.executionReady, false);
  assert.ok(result.warnings.some((warning) => warning.code === 'FUNDING_GAP'));
});

test('own cash reduces debt and interest without an invented equity charge', () => {
  const result = calculate({ ...base, ownCash: 40000 });
  assert.equal(result.initialFundingNeed, 60000);
  close(result.creditInterest, 60000 * 0.235 * 45 / 365);
  const covered = calculate({ ...base, ownCash: 100000, fundingKind: 'none' });
  assert.equal(covered.uncoveredGap, 0);
  assert.equal(covered.executionReady, true);
});

test('a 100% factor advances remaining invoice only after acceptance', () => {
  const result = calculate({ ...base, factorEnabled: true, factorAdvancePercent: 100, factorUpfront: false });
  assert.equal(day(result, 0).cash, -100000);
  assert.equal(day(result, 20).cash, 105000);
  close(day(result, 45).cash, -result.factorFeeGross);
  assert.equal(result.factorUsed, true);
  assert.equal(result.executionReady, false);
  assert.ok(result.warnings.some((warning) => warning.code === 'FACTOR_UNCONFIRMED'));
});

test('client advance and factor never pay the same portion of the invoice twice', () => {
  const result = calculate({ ...base, advancePercent: 40, factorEnabled: true, factorUpfront: false });
  assert.equal(result.clientAdvance, 42000);
  assert.equal(result.unpaidInvoice, 63000);
  assert.equal(result.factorAdvance, 59850);
  close(result.factorFeeNet, 63000 * 0.17 * 25 / 365);
  close(result.timeline.reduce((total, event) => total + event.cash, 0), 5000 - result.factorFeeGross);
  assert.equal(result.peakFundingNeed, 58000);
  const paid = calculate({ ...base, advancePercent: 100, factorEnabled: true, factorFixed: 1000 });
  assert.equal(paid.factorUsed, false);
  assert.equal(paid.factorFeeNet, 0);
  assert.equal(paid.peakFundingNeed, 0);
});

test('supplier deferral changes only the days when money is needed', () => {
  const result = calculate({ ...base, supplierDay: 10 });
  assert.equal(result.initialFundingNeed, 0);
  assert.equal(result.financingRublesDays, 100000 * 35);
  close(result.creditInterest, 100000 * 0.235 * 35 / 365);
  const clientBeforeSupplier = calculate({ ...base, supplierDay: 50, fundingKind: 'none' });
  assert.equal(clientBeforeSupplier.peakFundingNeed, 0);
  assert.equal(clientBeforeSupplier.executionReady, true);
});

test('acceptance anchor, factor delay, and late payment are distinct events', () => {
  const result = calculate({ ...base, delayAnchor: 'acceptance', factorEnabled: true, factorDelay: 3, lateDays: 7 });
  assert.equal(result.dueDay, 65);
  assert.equal(result.paymentDay, 72);
  assert.equal(result.factorDay, 23);
  assert.equal(result.factorDays, 49);
  const paymentAnchor = calculate({ ...base, acceptanceDay: 100, lateDays: 7 });
  assert.equal(paymentAnchor.paymentDay, 52);
});

test('factor payout on or after customer payment disables deal fees but keeps subscription', () => {
  for (const acceptanceDay of [45, 46]) {
    const result = calculate({ ...base, acceptanceDay, factorEnabled: true,
      factorFixed: 9000, factorFeePercent: 5, factorMonthly: 1200 });
    assert.equal(result.factorUsed, false);
    assert.equal(result.factorFeeNet, 0);
    assert.equal(result.factorAdvance, 0);
    assert.equal(result.breakdown.subscriptions, 1);
    assert.equal(result.timeline.length, 2);
    assert.equal(result.executionReady, true);
  }
});

test('unavailable factor advances no cash and charges no deal fees but keeps active monthly fees', () => {
  const input = { ...base, factorEnabled: true, factorUnavailable: true,
    factorMonthly: 6000, factorFeePercent: 2, factorFixed: 1000 };
  const result = calculate(input);
  assert.equal(result.factorUsed, false);
  assert.equal(result.factorAdvance, 0);
  assert.equal(result.factorFeeNet, 0);
  assert.equal(result.factorFeeGross, 0);
  assert.equal(result.breakdown.subscriptions, 5);
  assert.equal(result.timeline.length, 2);
  close(result.creditInterest, 100000 * 0.235 * 45 / 365);
  close(result.profit, calculate(base).profit - 5);
  assert.equal(result.executionReady, true);
  assert.match(result.warnings.find((warning) => warning.code === 'FACTOR_UNUSED').message, /не перечислил/);
  const long = calculate({ ...input, delayAnchor: 'acceptance', clientDays: 3650,
    acceptanceDay: 3650, lateDays: 3650 });
  assert.equal(long.paymentDay, 10950);
  assert.equal(long.factorUsed, false);
});

test('factor advance-base annual fee and invoice-base one-time fee are separate', () => {
  const result = calculate({ ...base, factorEnabled: true, factorRateBase: 'advance',
    advancePercent: 20, factorFeePercent: 1, factorFixed: 100, factorUpfront: false });
  close(result.factorFeeNet, 79800 * 0.17 * 25 / 365 + 84000 * 0.01 + 100);
});

test('fee VAT changes actual cash needs while economic fees are net of deductible VAT', () => {
  const result = calculate({ ...base, fundingFeeFixed: 1000, fundingFeeVatPercent: 20 });
  assert.equal(result.breakdown.fundingSetup, 1000);
  assert.equal(result.fundingSetupGross, 1200);
  assert.equal(result.cashFeeVAT, 200);
  assert.equal(result.peakFundingNeed, 101200);
  close(result.creditInterest, 101200 * 0.235 * 45 / 365);
  close(result.profit, 5000 / 1.22 - 1000 - 515000 / 1200 - result.creditInterest);
});

test('guarantee collateral returns while LC coverage pays the supplier; commissions are expenses', () => {
  const result = calculate({ ...base, guaranteeEnabled: true, guaranteeRate: 12,
    guaranteeDays: 30, guaranteeFeePercent: 1, guaranteeFixed: 100,
    guaranteeVatPercent: 20, guaranteeCollateral: 20000,
    lcEnabled: true, lcFeePercent: 0.5, lcFixed: 50, lcVatPercent: 20, lcCollateral: 30000 });
  close(result.guaranteeFeeNet, 105000 * 0.12 * 30 / 365 + 1050 + 100);
  assert.equal(result.lcFeeNet, 575);
  close(result.initialFundingNeed, 120000 + result.guaranteeFeeGross + result.lcFeeGross);
  assert.equal(day(result, 45).cash, 125000);
  close(result.closingCashAfterInterest,
    5000 - result.guaranteeFeeGross - result.lcFeeGross - result.creditInterest);
  assert.equal(result.breakdown.guarantee, result.guaranteeFeeNet);
  assert.equal(result.breakdown.lc, 575);
});

test('fully covered LC spends its blocked cash once and finances coverage plus gross fees', () => {
  const result = calculate({ ...base, clientDays: 30, supplierDay: 20,
    lcEnabled: true, lcCollateral: 100000, lcFeePercent: 1, lcFixed: 100, lcVatPercent: 20 });
  assert.equal(result.lcFeeNet, 1150);
  assert.equal(result.lcFeeGross, 1380);
  assert.equal(result.lcApplied, 100000);
  assert.equal(result.lcUnusedCoverage, 0);
  assert.equal(result.peakFundingNeed, 101380);
  assert.equal(day(result, 0).cash, -101380);
  assert.equal(day(result, 20).cash, 0);
  assert.equal(day(result, 30).cash, 105000);
  close(result.creditInterest, 101380 * 0.235 * 30 / 365);
  close(result.closingCashAfterInterest, 5000 - 1380 - result.creditInterest);
  assert.equal(result.breakdown.lc, 1150);
  assert.equal(result.cashFeeVAT, 230);
});

test('partial LC coverage leaves only the uncovered supplier amount as new cash outflow', () => {
  const result = calculate({ ...base, clientDays: 30, supplierDay: 20,
    lcEnabled: true, lcCollateral: 30000 });
  assert.equal(day(result, 0).cash, -30000);
  assert.equal(day(result, 20).cash, -70000);
  assert.equal(result.peakFundingNeed, 100000);
  assert.equal(result.financingRublesDays, 30000 * 20 + 100000 * 10);
  assert.equal(result.lcApplied, 30000);
  assert.equal(result.lcUnusedCoverage, 0);
  close(result.closingCashAfterInterest, 5000 - result.creditInterest);
});

test('LC coverage above purchase returns only its unused remainder after supplier and client', () => {
  const result = calculate({ ...base, clientDays: 30, supplierDay: 20,
    lcEnabled: true, lcCollateral: 150000 });
  assert.equal(result.lcApplied, 100000);
  assert.equal(result.lcUnusedCoverage, 50000);
  assert.equal(day(result, 20).cash, 0);
  assert.equal(day(result, 30).cash, 155000);
  assert.equal(result.peakFundingNeed, 150000);
  close(result.closingCashAfterInterest, 5000 - result.creditInterest);
});

test('LC unused coverage remains blocked until the supplier is paid when client pays earlier', () => {
  const result = calculate({ ...base, clientDays: 10, supplierDay: 20,
    lcEnabled: true, lcCollateral: 150000 });
  assert.equal(day(result, 0).cash, -150000);
  assert.equal(day(result, 10).cash, 105000);
  assert.equal(day(result, 10).loanNeed, 45000);
  assert.equal(day(result, 20).cash, 50000);
  assert.equal(result.financingRublesDays, 150000 * 10 + 45000 * 10);
  close(result.closingCashAfterInterest, 5000 - result.creditInterest);
  const guaranteed = calculate({ ...base, clientDays: 10, supplierDay: 20,
    guaranteeEnabled: true, guaranteeCollateral: 50000 });
  assert.equal(day(guaranteed, 10).cash, 155000);
});

test('same-day payments are explicitly netted and require no intraday financing', () => {
  const result = calculate({ ...base, clientDays: 0, fundingKind: 'none' });
  assert.equal(result.timeline.length, 1);
  assert.equal(result.timeline[0].cash, 5000);
  assert.equal(result.peakFundingNeed, 0);
  assert.equal(result.executionReady, true);
});

test('confirmed funding limit controls execution, independently from factor confirmation', () => {
  const insufficient = calculate({ ...base, fundingLimit: 99999 });
  assert.equal(insufficient.uncoveredGap, 1);
  assert.equal(insufficient.executionReady, false);
  const factor = calculate({ ...base, factorEnabled: true, fundingLimit: 50000 });
  assert.equal(factor.uncoveredGap, 50000);
  assert.equal(factor.executionReady, false);
  const sufficient = calculate({ ...base, factorEnabled: true, factorConfirmed: true });
  assert.equal(sufficient.uncoveredGap, 0);
  assert.equal(sufficient.executionReady, true);
  const overdraft = calculate({ ...base, fundingKind: 'overdraft' });
  close(overdraft.creditInterest, insufficient.creditInterest);
});

test('monthly subscriptions are allocated once, independent of deal length and outside timeline', () => {
  const fees = { fundingMonthly: 12000, factorEnabled: true, factorMonthly: 6000,
    accountEnabled: true, accountMonthly: 2400, factorVatPercent: 20,
    fundingFeeVatPercent: 20, accountVatPercent: 20, acceptanceDay: 100 };
  const week = calculate({ ...base, ...fees, clientDays: 7 });
  const month = calculate({ ...base, ...fees, clientDays: 30 });
  assert.equal(week.monthlyBankFeesNet, 20400);
  assert.equal(week.monthlyBankFeesGross, 24480);
  assert.equal(week.breakdown.subscriptions, 17);
  assert.equal(week.subscriptionGrossPerWagon, 20.4);
  assert.equal(month.breakdown.subscriptions, 17);
  assert.equal(week.initialFundingNeed, 100000);
  close(week.cashFeeVAT, 3.4);
  const inactive = calculate({ ...base, ...fees, fundingKind: 'none', factorEnabled: false });
  assert.equal(inactive.monthlyBankFeesNet, 2400);
  assert.equal(inactive.breakdown.subscriptions, 2);
});

test('rare products allocate subscriptions using each active product volume', () => {
  const result = calculate({ ...base, fundingMonthly: 12000, fundingMonthlyVolume: 600,
    factorEnabled: true, factorMonthly: 6000, factorMonthlyVolume: 10,
    accountEnabled: true, accountMonthly: 2400, accountMonthlyVolume: 1200 });
  assert.equal(result.breakdown.subscriptions, 622);
  assert.ok(result.warnings.some((warning) => warning.code === 'MONTHLY_VOLUME_DIFFERENT'));
  assert.equal(result.monthlyExpectedProfit, null);
  assert.match(result.monthlyProjectionNote, /Разные объёмы по инструментам/);
});

test('a rare factor product has a valid per-wagon cost and price minimum but no overall monthly projection', () => {
  const input = { ...base, volume: 1200, factorEnabled: true, factorMonthly: 6000, factorMonthlyVolume: 10 };
  const result = calculate(input);
  assert.equal(result.breakdown.subscriptions, 600);
  assert.equal(result.monthlyExpectedProfit, null);
  const warning = result.warnings.find((item) => item.code === 'MONTHLY_VOLUME_DIFFERENT');
  assert.match(warning.message, /Месячный итог не рассчитывается/);
  const minimum = minimumMarkup(input);
  assert.ok(minimum);
  assert.ok(minimum.profit >= 0);
  assert.ok(calculate({ ...input, markup: minimum.markup - 10 }).profit < 0);
  const inactive = calculate({ ...input, factorEnabled: false });
  close(inactive.monthlyExpectedProfit, inactive.profit * 1200);
  const free = calculate({ ...input, factorMonthly: 0 });
  close(free.monthlyExpectedProfit, free.profit * 1200);
});

test('negative markup is accepted but can leave a closing debt even with enough initial credit', () => {
  const result = calculate({ ...base, markup: -1000 });
  assert.ok(result.profit < 0);
  assert.ok(result.closingDebt > 1000);
  assert.equal(result.uncoveredGap, 0);
  assert.equal(result.executionReady, false);
});

test('minimum markup is the first economic 10-ruble price and preserves limited financing', () => {
  const minimum = minimumMarkup({ ...base, fundingLimit: 0 }, 1000);
  assert.ok(minimum);
  assert.equal(minimum.markup % 10, 0);
  assert.equal(minimum.price, DEFAULTS.purchase + minimum.markup);
  assert.ok(minimum.profit >= 1000);
  assert.ok(calculate({ ...base, markup: minimum.markup - 10 }).profit < 1000);
  assert.equal(calculate({ ...base, markup: minimum.markup, fundingLimit: 0 }).executionReady, false);
  assert.deepEqual(minimumMarkup({ fundingKind: 'none', monthlyOverhead: 0 }),
    { markup: 0, price: 100000, profit: 0 });
  assert.equal(minimumMarkup(base, 10000000), null);
});

test('minimum pricing handles non-monotone high-fee economics without overlooking a feasible price', () => {
  const input = { ownCash: 300000, insuranceEnabled: true, insurancePercent: 80,
    fundingRate: 1000, clientDays: 365, monthlyOverhead: 0 };
  assert.ok(calculate({ ...input, markup: 1000000 }).profit < -79000);
  const minimum = minimumMarkup(input, -79000);
  assert.equal(minimum.markup, 50840);
  assert.ok(minimum.profit >= -79000);
  assert.ok(calculate({ ...input, markup: 50830 }).profit < -79000);
});

test('scenario comparison uses contractual rates and only active subscriptions', () => {
  const results = compareScenarios({ ...base, fundingRate: 12, fundingMonthly: 12000,
    factorMonthly: 6000, accountEnabled: true, accountMonthly: 2400 });
  assert.equal(results.length, 5);
  assert.deepEqual(results.map((scenario) => scenario.id),
    ['cash', 'credit', 'credit-insurance', 'credit-factor', 'credit-factor-insurance']);
  const byId = Object.fromEntries(results.map((scenario) => [scenario.id, scenario.result]));
  assert.equal(byId.cash.breakdown.subscriptions, 2);
  assert.equal(byId.credit.breakdown.subscriptions, 12);
  assert.equal(byId['credit-factor'].breakdown.subscriptions, 17);
  close(byId.credit.creditInterest, 100000 * 0.12 * 45 / 365);
  assert.equal(byId.credit.breakdown.insurance, 0);
  assert.equal(byId['credit-insurance'].breakdown.insurance, 525);
  assert.equal(byId['credit-factor'].factorUsed, true);
});

test('invalid, fractional day, wrong enum, and non-finite inputs fail with useful RangeErrors', () => {
  const invalid = [
    { purchase: 0 }, { purchase: -1 }, { markup: -100000 }, { markup: NaN },
    { fundingRate: Infinity }, { fundingRate: 1001 }, { clientDays: 1.5 },
    { clientDays: 3651 }, { clientDays: -1 }, { volume: 0 }, { volume: 2.5 },
    { fundingFeeFixed: -1 }, { factorAdvancePercent: 101 }, { vatPercent: 101 },
    { factorVatPercent: -1 }, { fundingMonthlyVolume: 2.5 }, { factorMonthlyVolume: -1 },
    { fundingKind: 'unknown' }, { delayAnchor: 'invoice' }, { factorRateBase: 'purchase' },
    { factorEnabled: 'yes' }, { factorUnavailable: 'yes' },
    { purchase: '100000' }, { purchase: 1e308, clientDays: 3650 },
  ];
  for (const input of invalid) assert.throws(() => calculate(input), RangeError, JSON.stringify(input));
  assert.throws(() => calculate(null), RangeError);
  assert.throws(() => calculate([]), RangeError);
  assert.throws(() => minimumMarkup({}, NaN), RangeError);
});
