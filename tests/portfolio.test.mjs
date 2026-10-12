import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePortfolio, minimumPortfolioMarkup } from '../portfolio.mjs';
import { TOCHKA_PROFILE, LINE_PROFILE } from '../bank-profile.mjs';

const close = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Ожидалось ${expected}, получено ${actual}`);
};
const loan = { ...TOCHKA_PROFILE, fundingScheduleConfirmed: true, fundingLimit: 100000,
  purchase: 100000, markup: 10000, monthlyOverhead: 0, flowMonths: 3,
  flowMonthlyVolume: 3, flowLoanAmount: 100000, flowDispatch: 'uniform' };

test('flat original-loan fee is allocated over months times monthly wagons without a gross-up', () => {
  for (const [volume, perWagon] of [[1, 2490], [3, 830], [10, 249]]) {
    const result = calculatePortfolio({ ...loan, flowMonthlyVolume: volume });
    close(result.creditInterest, 7470);
    close(result.bankCostPerWagon, perWagon);
    assert.equal(result.totalWagons, volume * 3);
    assert.equal(result.creditPricing.amount, 100000);
    close(result.creditPricing.netAvailable, 97510);
    close(result.principalRepaid, 100000);
  }
});

test('a larger constant flow lowers flat fees per wagon but increases its funding gap', () => {
  const small = calculatePortfolio({ ...loan, flowMonthlyVolume: 1 });
  const large = calculatePortfolio({ ...loan, flowMonthlyVolume: 10 });
  assert.ok(large.bankCostPerWagon < small.bankCostPerWagon);
  assert.ok(large.uncoveredGap > small.uncoveredGap);
});

test('principal amortisation changes cash but is never an economic expense', () => {
  const equal = calculatePortfolio(loan);
  const bullet = calculatePortfolio({ ...loan, fundingPrincipalMode: 'fixed', fundingPrincipalMonthly: 0 });
  close(equal.profitPerWagon, bullet.profitPerWagon);
  close(equal.totalProfit, 9 * 10000 / 1.22 - 7470);
  assert.notEqual(equal.timeline.find(row => row.day === 30).cashEnd,
    bullet.timeline.find(row => row.day === 30).cashEnd);
  close(equal.months.reduce((sum, month) => sum + month.principal, 0), 100000);
});

test('factoring changes operating liquidity but leaves fixed original-loan commission intact', () => {
  const plain = calculatePortfolio({ ...loan, clientDays: 60 });
  const factor = calculatePortfolio({ ...loan, clientDays: 60, factorEnabled: true, factorConfirmed: true });
  close(factor.creditInterest, plain.creditInterest);
  assert.ok(factor.uncoveredGap < plain.uncoveredGap);
  close(plain.profitPerWagon - factor.profitPerWagon, factor.breakdownPerWagon.factor);
  assert.equal(factor.factorDay, 20);
});

test('a revolving line charges actual drawn ruble-days rather than its limit', () => {
  const result = calculatePortfolio({ ...LINE_PROFILE, purchase: 100000, markup: 0, monthlyOverhead: 0,
    vatPercent: 0, clientDays: 10, flowMonths: 3, flowMonthlyVolume: 1,
    flowLoanAmount: 500000, fundingLimit: 500000, ownCash: 0,
    fundingRepaymentReserve: 10000 });
  close(result.financingRublesDays, 100000 * 10 * 3);
  close(result.creditInterest, 100000 * 10 * 3 * .235 / 365);
  close(result.cash.maxDebt, 100000);
  assert.equal(result.uncoveredGap, 0);
});

test('own working cash is introduced once and a separate reserve pays only debt service', () => {
  const own = calculatePortfolio({ ...loan, flowMonthlyVolume: 1, ownCash: 500000 });
  close(own.cash.end, 500000 + own.totalProfit);
  const reserve = calculatePortfolio({ ...loan, flowMonthlyVolume: 1, fundingRepaymentReserve: 100000 });
  assert.ok(reserve.cash.reserveUsed > 0);
  close(reserve.profitPerWagon, calculatePortfolio({ ...loan, flowMonthlyVolume: 1 }).profitPerWagon);
  close(reserve.cash.end + reserve.cash.reserveRemaining,
    100000 + reserve.totalProfit);
});

test('setup is once on fixed amount, subscriptions use service months, and overhead uses company volume', () => {
  const result = calculatePortfolio({ ...loan, fundingFeePercent: 1, fundingFeeFixed: 500,
    fundingMonthly: 3000, accountEnabled: true, accountMonthly: 12000,
    volume: 1200, monthlyOverhead: 515000 });
  close(result.breakdownPerWagon.fundingSetup, 1500 / 9);
  // The account remains active in the fourth 30-day service month: last
  // order starts on day 80 and is paid on day 110.
  close(result.breakdownPerWagon.subscriptions, 1000 + 12000 * 3 / 1200 * 4 / 9);
  close(result.breakdownPerWagon.overhead, 515000 / 1200);
});

test('VAT reserves apply before delayed payment and fee VAT is not an economic expense', () => {
  const result = calculatePortfolio({ ...loan, flowMonthlyVolume: 1, clientDays: 60,
    ownCash: 200000, fundingFeeFixed: 1000, fundingFeeVatPercent: 22 });
  const first = result.timeline.find(row => row.day === 0);
  close(first.vatReserve, 10000 - 10000 / 1.22 - 220);
  close(result.breakdownPerWagon.fundingSetup, 1000 / 3);
  assert.ok(result.warnings.some(warning => warning.code === 'VAT_RESERVE_ESTIMATE'));
});

test('horizon cash, unpaid invoices, and full tail are distinguished', () => {
  const result = calculatePortfolio({ ...loan, clientDays: 90, flowMonthlyVolume: 1, ownCash: 500000 });
  assert.equal(result.receivables.ordersOutstanding, 2);
  close(result.receivables.atHorizon, 220000);
  assert.equal(result.receivables.tailEndDay, 150);
  assert.ok(result.cash.end > result.cash.atHorizon);
});

test('target price covers bank, insurance and overhead while retaining feasibility warnings', () => {
  const input = { ...loan, insuranceEnabled: true, factorEnabled: true, factorConfirmed: true,
    clientDays: 45, monthlyOverhead: 515000 };
  const quote = minimumPortfolioMarkup(input, 2000);
  assert.ok(quote);
  assert.ok(quote.profit >= 2000);
  assert.ok(calculatePortfolio({ ...input, markup: quote.markup - 10 }).profitPerWagon < 2000);
  assert.equal(quote.price, input.purchase + quote.markup);
  assert.ok(quote.uncoveredGap > 0);
});

test('unsupported instruments, fractional wagons and inconsistent flow bounds are rejected explicitly', () => {
  for (const extra of [{ flowMonths: 2 }, { flowMonths: 13 }, { flowMonths: 3.5 },
    { flowMonthlyVolume: 0 }, { flowMonthlyVolume: 1.5 }, { flowMonthlyVolume: 1201 },
    { flowLoanAmount: -1 }, { flowLoanAmount: Infinity }, { guaranteeEnabled: true },
    { lcEnabled: true }, { fundingMonthlyBase: 'balance' }, { fundingInterestMode: 'monthly_daily' },
    { flowDispatch: 'unknown' }]) {
    assert.throws(() => calculatePortfolio({ ...loan, ...extra }), RangeError);
  }
});

test('loss-making economics and a cash deficit are separate results', () => {
  const result = calculatePortfolio({ ...loan, markup: 0, flowMonthlyVolume: 1, ownCash: 500000 });
  assert.ok(result.profitPerWagon < 0);
  assert.equal(result.uncoveredGap, 0);
  assert.equal(result.executionReady, true);
});

test('the price for a target already covered at zero markup is zero', () => {
  const quote = minimumPortfolioMarkup({ ...loan, fundingKind: 'none', monthlyOverhead: 0 }, 0);
  assert.equal(quote.markup, 0);
  assert.equal(quote.profit, 0);
});

test('factor and account subscriptions continue in the tail while a repaid fixed loan stops', () => {
  const result = calculatePortfolio({ ...loan, clientDays: 90, fundingMonthly: 100,
    factorEnabled: true, factorConfirmed: true, factorMonthly: 200,
    accountEnabled: true, accountMonthly: 12000 });
  assert.equal(result.serviceMonths, 6);
  close(result.subscriptionsNet, 100 * 3 + 200 * 6 + 12000 * 3 / 1200 * 6);
  assert.ok(result.warnings.some(warning => warning.code === 'FLOW_SERVICE_TAIL'));
});

test('batch purchases need at least as much liquidity as evenly dispatched physical wagons', () => {
  const uniform = calculatePortfolio({ ...loan, clientDays: 15 });
  const batch = calculatePortfolio({ ...loan, clientDays: 15, flowDispatch: 'monthly_batch' });
  assert.ok(batch.uncoveredGap > uniform.uncoveredGap);
  close(batch.creditInterest, uniform.creditInterest);
  assert.equal(batch.timeline.find(row => row.day === 0).purchases, 300000);
  assert.equal(uniform.timeline.find(row => row.day === 0).purchases, 100000);
});

test('confirmation affects readiness without changing price, cash, or profitability', () => {
  const unconfirmed = calculatePortfolio({ ...loan, ownCash: 500000, fundingScheduleConfirmed: false,
    fundingLimit: 0, flowMonthlyVolume: 1 });
  const confirmed = calculatePortfolio({ ...loan, ownCash: 500000, flowMonthlyVolume: 1 });
  close(unconfirmed.profitPerWagon, confirmed.profitPerWagon);
  close(unconfirmed.cash.end, confirmed.cash.end);
  assert.equal(unconfirmed.executionReady, false);
  assert.equal(confirmed.executionReady, true);
});

test('VAT beyond the positive reserve remains a credit rather than an assumed cash refund', () => {
  const result = calculatePortfolio({ ...loan, fundingKind: 'none', markup: -1000,
    flowMonthlyVolume: 1, ownCash: 500000 });
  assert.equal(result.vatReserved, 0);
  assert.ok(result.vatCreditBalance > 0);
  close(result.cash.end + result.vatCreditBalance, 500000 + result.totalProfit);
});

test('the separate reserve is earmarked for debt service so the reported gap can fund the plan once', () => {
  const input = { ...loan, clientDays: 15, ownCash: 0, fundingRepaymentReserve: 100000 };
  const initial = calculatePortfolio(input);
  const supplied = calculatePortfolio({ ...input, ownCash: initial.uncoveredGap });
  assert.ok(initial.uncoveredGap > 0);
  assert.equal(supplied.uncoveredGap, 0);
  close(initial.cash.reserveUsed, supplied.cash.reserveUsed);
  assert.ok(initial.timeline.every(row => row.reserveUsed <= row.principal + row.interest + 1e-7));
});

test('original funding fields are validated before per-order overrides can hide them', () => {
  for (const invalid of [{ fundingFeeFixed: -10000 }, { fundingFeePercent: -1 },
    { fundingMonthly: -1 }, { fundingMonthly: NaN }, { ownCash: -1 }, { ownCash: Infinity },
    { factorMonthly: -1 }, { factorMonthly: NaN }, { fundingKind: 'bogus' },
    { fundingKind: null }, { accountEnabled: 0 }, { accountEnabled: 'false' },
    { fundingScheduleConfirmed: 'true' }, { factorEnabled: 1 }, { fundingMonthlyUpfront: 'true' }]) {
    const input = { ...loan, ...invalid };
    assert.throws(() => calculatePortfolio(input), RangeError, JSON.stringify(invalid));
    assert.throws(() => minimumPortfolioMarkup(input, 1000), RangeError, JSON.stringify(invalid));
  }
});

test('original input validation does not apply a one-order loan gross-up to the fixed portfolio issue', () => {
  const result = calculatePortfolio({ ...loan, flowMonthlyVolume: 1, fundingMonthlyRate: 100 });
  assert.equal(result.creditPricing.amount, 100000);
  close(result.creditInterest, 300000);
});

test('calendar periods put day 30 in the second period and final day 90 in the tail period', () => {
  const result = calculatePortfolio({ ...loan, flowMonthlyVolume: 1 });
  assert.equal(result.serviceMonths, 3);
  assert.equal(result.months.length, 4);
  assert.deepEqual(result.months.map(month => [month.startDay, month.endDay]),
    [[0, 29], [30, 59], [60, 89], [90, 90]]);
  assert.deepEqual(result.months.slice(0, 3).map(month => month.purchases), [100000, 100000, 100000]);
  result.months.slice(0, 3).forEach(month => close(month.interest, 2490));
  close(result.months[3].principal, 100000 / 3);
  let previousCash = loan.ownCash || 0;
  for (const month of result.months) {
    close(month.cashStart, previousCash);
    const netCash = month.drawn + month.receipts + month.reserveUsed - month.purchases
      - month.principal - month.interest - month.otherBankFees - month.insurance
      - month.overhead - month.vatReserve;
    close(month.cashEnd, previousCash + netCash);
    const matchingRows = result.timeline.filter(row => row.day >= month.startDay && row.day <= month.endDay);
    close(month.cashEnd, previousCash + matchingRows.reduce((sum, row) => sum + row.cash, 0));
    previousCash = month.cashEnd;
  }
});

test('automatic line pricing finds the first feasible low price despite later non-monotone interest', () => {
  const input = { ...LINE_PROFILE, purchase: 100000, flowMonths: 3, flowMonthlyVolume: 1,
    ownCash: 400000, insuranceEnabled: true, insurancePercent: .5, monthlyOverhead: 0,
    clientDays: 3650 };
  for (const amount of [1000000, 3000000]) {
    const quote = minimumPortfolioMarkup({ ...input, flowLoanAmount: amount, fundingLimit: amount }, 2000);
    assert.ok(quote);
    assert.equal(quote.markup, 3070);
    assert.ok(quote.profit >= 2000);
    assert.ok(calculatePortfolio({ ...input, flowLoanAmount: amount, fundingLimit: amount,
      markup: 3060 }).profitPerWagon < 2000);
  }
});

test('all ordinary profit targets retain the first ten-ruble markup for a fixed original loan', () => {
  const input = { ...loan, monthlyOverhead: 515000 };
  for (const [target, expected] of [[1000, 2760], [2000, 3980], [3000, 5200], [4000, 6420], [5000, 7640]]) {
    const quote = minimumPortfolioMarkup(input, target);
    assert.equal(quote.markup, expected);
    assert.ok(quote.profit >= target);
    assert.ok(calculatePortfolio({ ...input, markup: expected - 10 }).profitPerWagon < target);
  }
});

test('line segment pricing agrees with exhaustive lower-grid economics across cash and factor branches', () => {
  const common = { ...LINE_PROFILE, purchase: 10000, flowMonths: 3, flowMonthlyVolume: 2,
    flowLoanAmount: 25000, fundingLimit: 25000, monthlyOverhead: 0 };
  const scenarios = [
    { clientDays: 45, ownCash: 0, fundingRepaymentReserve: 1000 },
    { clientDays: 120, ownCash: 20000, fundingRepaymentReserve: 1000,
      fundingRate: 75, factorEnabled: true, factorConfirmed: true, insuranceEnabled: true,
      factorFixed: 300, factorVatPercent: 22, accountEnabled: true, accountMonthly: 1200 },
    { clientDays: 60, ownCash: 10000, advancePercent: 50, supplierDay: 20,
      vatPercent: 0, fundingFeePercent: 1, fundingFeeFixed: 200, fundingMonthly: 100 },
  ];
  for (const scenario of scenarios) {
    const input = { ...common, ...scenario };
    for (const target of [1000, 2000, 3000, 4000, 5000]) {
      const quote = minimumPortfolioMarkup(input, target);
      assert.ok(quote);
      assert.ok(quote.profit >= target);
      for (let markup = 0; markup < quote.markup; markup += 10) {
        assert.ok(calculatePortfolio({ ...input, markup }).profitPerWagon < target,
          `Пропущена цена ${markup} для цели ${target}: ${JSON.stringify(scenario)}`);
      }
    }
  }
});
