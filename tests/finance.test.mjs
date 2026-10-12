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
