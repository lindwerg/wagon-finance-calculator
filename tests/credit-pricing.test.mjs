import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../finance.mjs';
import { priceCredit } from '../credit-pricing.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `Ожидалось ${expected}, получено ${actual}`);
const pricing = (params = {}, timeline = [{ day: 0, loanNeed: 100000 }, { day: 45, loanNeed: 0 }], paymentDay = 45) =>
  priceCredit({ ...DEFAULTS, ...params }, timeline, paymentDay);
const flatUpfront = { fundingInterestMode: 'monthly_full', fundingMonthlyRate: 2.49,
  fundingMonthlyBase: 'initial', fundingMonthlyUpfront: true, fundingCloseMode: 'scheduled',
  fundingPrincipalMode: 'equal', fundingTermMonths: 3, fundingLoanMin: 50000, fundingLoanMax: 27510000 };

test('annual daily default retains simple interest paid only at settlement', () => {
  const result = pricing();
  close(result.creditInterest, 100000 * 0.235 * 45 / 365);
  assert.equal(result.principalRepaid, 0);
  assert.equal(result.repaymentsBeforeClient, 0);
  assert.equal(result.repaymentReserveGap, 0);
  assert.deepEqual(result.repaymentSchedule, [{ day: 45, principal: 0,
    interest: result.creditInterest, total: result.creditInterest }]);
});

test('seven days at two percent monthly separates a started month from daily accrual', () => {
  const timeline = [{ day: 0, loanNeed: 100000 }, { day: 7, loanNeed: 0 }];
  const full = pricing({ fundingInterestMode: 'monthly_full' }, timeline, 7);
  const daily = pricing({ fundingInterestMode: 'monthly_daily' }, timeline, 7);
  assert.equal(full.creditInterest, 2000);
  close(daily.creditInterest, 100000 * 0.02 * 7 / 30);
  assert.equal(full.repaymentReserveGap, 0);
  assert.equal(full.repaymentSchedule[0].day, 7);
  assert.equal(full.periods.length, 1);
});

test('forty-five days in full monthly mode costs two started months without amortisation', () => {
  const result = pricing({ fundingInterestMode: 'monthly_full' });
  assert.equal(result.creditInterest, 4000);
  assert.equal(result.principalRepaid, 0);
  assert.deepEqual(result.repaymentSchedule, [
    { day: 30, principal: 0, interest: 2000, total: 2000 },
    { day: 45, principal: 0, interest: 2000, total: 2000 },
  ]);
  assert.equal(result.repaymentsBeforeClient, 2000);
  assert.equal(result.repaymentReserveGap, 2000);
});

test('principal reserve repays twenty thousand on day thirty and lowers the next monthly balance', () => {
  const params = { fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000 };
  const result = pricing(params);
  assert.equal(result.creditInterest, 3600);
  assert.equal(result.principalRepaid, 20000);
  assert.deepEqual(result.repaymentSchedule, [
    { day: 30, principal: 20000, interest: 2000, total: 22000 },
    { day: 45, principal: 0, interest: 1600, total: 1600 },
  ]);
  assert.equal(result.repaymentsBeforeClient, 22000);
  assert.equal(result.repaymentReserveGap, 22000);
  assert.equal(pricing({ ...params, fundingRepaymentReserve: 22000 }).repaymentReserveGap, 0);
});

test('annual instalments accrue on actual debt with independent thirty- and fifteen-day weights', () => {
  const result = pricing({ fundingPrincipalMonthly: 20000 });
  close(result.creditInterest, (100000 * 30 + 80000 * 15) * 0.235 / 365);
  close(result.repaymentSchedule[0].interest, 100000 * 0.235 * 30 / 365);
  close(result.repaymentSchedule[1].interest, 80000 * 0.235 * 15 / 365);
  close(result.repaymentsBeforeClient, 20000 + 100000 * 0.235 * 30 / 365);
});

test('daily monthly instalments use thirty days and disregard the full-mode minimum months', () => {
  const result = pricing({ fundingInterestMode: 'monthly_daily', fundingPrincipalMonthly: 20000,
    fundingMinimumMonths: 120, fundingMonthlyBase: 'initial' });
  assert.equal(result.creditInterest, 2800);
  assert.equal(result.repaymentsBeforeClient, 22000);
  assert.deepEqual(result.repaymentSchedule.map(payment => payment.interest), [2000, 800]);
});

test('factor cash before an instalment caps principal at the remaining debt and ends further charges', () => {
  const timeline = [{ day: 0, loanNeed: 100000 }, { day: 20, loanNeed: 250 }, { day: 45, loanNeed: 0 }];
  const result = pricing({ fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000 }, timeline);
  assert.equal(result.creditInterest, 2000);
  assert.equal(result.principalRepaid, 250);
  assert.deepEqual(result.repaymentSchedule, [{ day: 30, principal: 250, interest: 2000, total: 2250 }]);
  assert.equal(result.periods.length, 1);
  assert.equal(result.repaymentReserveGap, 2250);
});

test('customer cash on the thirtieth day is netted before the instalment and needs no earlier reserve', () => {
  const timeline = [{ day: 0, loanNeed: 100000 }, { day: 30, loanNeed: 0 }];
  const result = pricing({ fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000 }, timeline, 30);
  assert.equal(result.creditInterest, 2000);
  assert.equal(result.principalRepaid, 0);
  assert.equal(result.repaymentsBeforeClient, 0);
  assert.equal(result.repaymentReserveGap, 0);
  assert.equal(result.repaymentSchedule[0].principal, 0);
});

test('minimum two paid months on a seven-day loan are charged at its settlement', () => {
  const timeline = [{ day: 0, loanNeed: 100000 }, { day: 7, loanNeed: 0 }];
  const result = pricing({ fundingInterestMode: 'monthly_full', fundingMinimumMonths: 2 }, timeline, 7);
  assert.equal(result.creditInterest, 4000);
  assert.equal(result.periods.length, 2);
  assert.equal(result.repaymentSchedule[0].interest, 4000);
  assert.equal(result.repaymentSchedule[0].day, 7);
  assert.equal(result.repaymentReserveGap, 0);
});

test('initial balance agreement retains original base after amortisation', () => {
  const result = pricing({ fundingInterestMode: 'monthly_full', fundingMonthlyBase: 'initial',
    fundingPrincipalMonthly: 20000 });
  assert.equal(result.creditInterest, 4000);
  assert.deepEqual(result.periods.map(period => period.base), [100000, 100000]);
});

test('a new draw inside a period uses its highest actual balance for full monthly interest', () => {
  const timeline = [{ day: 0, loanNeed: 1000 }, { day: 10, loanNeed: 100000 },
    { day: 20, loanNeed: 20000 }, { day: 45, loanNeed: 0 }];
  const result = pricing({ fundingInterestMode: 'monthly_full' }, timeline);
  assert.equal(result.creditInterest, 2400);
  assert.deepEqual(result.periods.map(period => period.base), [100000, 20000]);
});

test('the first draw starts the payment clock instead of assuming a loan on day zero', () => {
  const timeline = [{ day: 0, loanNeed: 0 }, { day: 12, loanNeed: 100000 }, { day: 57, loanNeed: 0 }];
  const result = pricing({ fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000 }, timeline, 57);
  assert.deepEqual(result.repaymentSchedule.map(payment => payment.day), [42, 57]);
  assert.equal(result.creditInterest, 3600);
  assert.equal(result.repaymentsBeforeClient, 22000);
});

test('no funding product or no needed draw produces no interest, instalments or reserve requirement', () => {
  for (const result of [pricing({ fundingKind: 'none', fundingInterestMode: 'monthly_full',
    fundingMinimumMonths: 120, fundingPrincipalMonthly: 20000 }),
  pricing({ fundingInterestMode: 'monthly_full' }, [{ day: 0, loanNeed: 0 }, { day: 45, loanNeed: 0 }])]) {
    assert.equal(result.creditInterest, 0);
    assert.equal(result.principalRepaid, 0);
    assert.equal(result.repaymentsBeforeClient, 0);
    assert.equal(result.repaymentReserveGap, 0);
    assert.deepEqual(result.repaymentSchedule, []);
    assert.deepEqual(result.periods, []);
  }
});

test('scheduled credit retains three months of interest and repays remaining principal on the term date', () => {
  const params = { fundingCloseMode: 'scheduled', fundingInterestMode: 'monthly_full',
    fundingPrincipalMonthly: 20000, fundingTermMonths: 3 };
  const timeline = [{ day: 0, loanNeed: 100000, cumulative: -100000 },
    { day: 45, loanNeed: 0, cumulative: 5000 }];
  const result = pricing(params, timeline);
  assert.equal(result.loanAmount, 100000);
  assert.equal(result.creditInterest, 4800);
  assert.equal(result.principalRepaid, 100000);
  assert.deepEqual(result.repaymentSchedule, [
    { day: 30, principal: 20000, interest: 2000, total: 22000 },
    { day: 60, principal: 20000, interest: 1600, total: 21600 },
    { day: 90, principal: 60000, interest: 1200, total: 61200 },
  ]);
  assert.equal(result.repaymentsBeforeClient, 22000);
  assert.equal(result.repaymentReserveGap, 22000);
  assert.equal(pricing({ ...params, fundingRepaymentReserve: 22000 }, timeline).repaymentReserveGap, 0);
});

test('factor receipts finance scheduled payments but do not automatically reduce contracted loan interest', () => {
  const params = { fundingCloseMode: 'scheduled', fundingInterestMode: 'monthly_full',
    fundingPrincipalMonthly: 20000, fundingTermMonths: 3 };
  const timeline = [{ day: 0, loanNeed: 100000, cumulative: -100000 },
    { day: 20, loanNeed: 250, cumulative: -250 }, { day: 45, loanNeed: 0, cumulative: 5000 }];
  const result = pricing(params, timeline);
  assert.equal(result.creditInterest, 4800);
  assert.equal(result.repaymentsBeforeClient, 22000);
  assert.equal(result.repaymentReserveGap, 0);
  assert.equal(result.repaymentSchedule[0].principal, 20000);
});

test('early customer cash funds the scheduled loan while interest remains due for the full term', () => {
  const params = { fundingCloseMode: 'scheduled', fundingInterestMode: 'monthly_full',
    fundingPrincipalMonthly: 20000, fundingTermMonths: 3 };
  const timeline = [{ day: 0, loanNeed: 100000, cumulative: -100000 },
    { day: 7, loanNeed: 0, cumulative: 5000 }];
  const result = pricing(params, timeline, 7);
  assert.equal(result.creditInterest, 4800);
  assert.equal(result.repaymentReserveGap, 0);
  assert.equal(result.repaymentsBeforeClient, 0);
  assert.deepEqual(result.repaymentSchedule.map(payment => payment.day), [30, 60, 90]);
});

test('scheduled reserve uses the maximum cumulative cash deficit, including incoming trade cash', () => {
  const params = { fundingCloseMode: 'scheduled', fundingInterestMode: 'monthly_full',
    fundingPrincipalMonthly: 20000, fundingTermMonths: 3 };
  const timeline = [{ day: 0, loanNeed: 100000, cumulative: -100000 },
    { day: 40, loanNeed: 50000, cumulative: -50000 }, { day: 100, loanNeed: 0, cumulative: 10000 }];
  const result = pricing(params, timeline, 100);
  assert.equal(result.repaymentsBeforeClient, 104800);
  assert.equal(result.repaymentReserveGap, 54800);
  assert.equal(pricing({ ...params, fundingRepaymentReserve: 54800 }, timeline, 100).repaymentReserveGap, 0);
});

test('scheduled annual interest pays monthly and remains independent of customer receipt timing', () => {
  const params = { fundingCloseMode: 'scheduled', fundingInterestMode: 'annual_daily',
    fundingPrincipalMonthly: 20000, fundingTermMonths: 3 };
  const timeline = [{ day: 0, loanNeed: 100000, cumulative: -100000 },
    { day: 45, loanNeed: 0, cumulative: 5000 }];
  const result = pricing(params, timeline);
  close(result.creditInterest, (100000 + 80000 + 60000) * 0.235 * 30 / 365);
  close(result.repaymentSchedule[0].total, 20000 + 100000 * 0.235 * 30 / 365);
  assert.equal(result.repaymentSchedule.at(-1).principal, 60000);
});

test('upfront flat monthly commission grosses up the original loan and is charged on days zero thirty sixty', () => {
  const timeline = [{ day: 0, loanNeed: 100000, cumulative: -100000 },
    { day: 45, loanNeed: 0, cumulative: 20000 }];
  const result = pricing(flatUpfront, timeline);
  const amount = 100000 / (1 - 0.0249);
  const fee = amount * 0.0249;
  close(result.amount, amount);
  close(result.loanAmount, amount);
  close(result.firstFee, fee);
  close(result.netAvailable, 100000);
  close(result.creditInterest, fee * 3);
  assert.deepEqual(result.repaymentSchedule.map(payment => payment.day), [0, 30, 60, 90]);
  for (const payment of result.repaymentSchedule.filter(payment => payment.day < 90)) close(payment.interest, fee);
  assert.equal(result.repaymentSchedule.at(-1).interest, 0);
  close(result.repaymentSchedule[1].total, amount / 3 + fee);
  close(result.repaymentReserveGap, amount / 3 + fee);
  close(result.principalRepaid, amount);
});

test('factor cash covers the upfront loan schedule while every flat monthly commission remains unchanged', () => {
  const timeline = [{ day: 0, loanNeed: 100000, cumulative: -100000 },
    { day: 20, loanNeed: 1000, cumulative: -1000 }, { day: 45, loanNeed: 0, cumulative: 20000 }];
  const result = pricing(flatUpfront, timeline);
  close(result.creditInterest, 100000 / 0.9751 * 0.0249 * 3);
  assert.equal(result.repaymentReserveGap, 0);
  assert.equal(result.tradeFundingGap, 0);
  close(result.repaymentSchedule[1].principal, result.amount / 3);
});

test('unused cash from the minimum loan can fund required monthly payments', () => {
  const timeline = [{ day: 0, loanNeed: 10000, cumulative: -10000 },
    { day: 45, loanNeed: 0, cumulative: 20000 }];
  const result = pricing(flatUpfront, timeline);
  assert.equal(result.amount, 50000);
  assert.equal(result.firstFee, 1245);
  assert.equal(result.netAvailable, 48755);
  close(result.creditInterest, 3735);
  assert.equal(result.repaymentReserveGap, 0);
});

test('minimum loan floor never creates a borrowing need when trade cash is already financed', () => {
  const timeline = [{ day: 0, loanNeed: 0, cumulative: 0 }, { day: 45, loanNeed: 0, cumulative: 10000 }];
  const result = pricing(flatUpfront, timeline);
  assert.equal(result.amount, 0);
  assert.equal(result.firstFee, 0);
  assert.equal(result.creditInterest, 0);
  assert.deepEqual(result.repaymentSchedule, []);
});

test('approved seven-day early closing still finances the first upfront fee and pays only one full period', () => {
  const timeline = [{ day: 0, loanNeed: 100000, cumulative: -100000 },
    { day: 7, loanNeed: 0, cumulative: 20000 }];
  const result = pricing({ ...flatUpfront, fundingCloseMode: 'on_client' }, timeline, 7);
  close(result.amount, 100000 / 0.9751);
  close(result.creditInterest, result.firstFee);
  assert.equal(result.periods.length, 1);
  assert.equal(result.repaymentSchedule[0].day, 0);
  assert.equal(result.repaymentReserveGap, 0);
});

test('trade cash between bank payments cannot be spent twice after an earlier loan instalment', () => {
  const timeline = [{ day: 0, loanNeed: 20000, cumulative: -20000 },
    { day: 50, loanNeed: 120000, cumulative: -120000 },
    { day: 55, loanNeed: 0, cumulative: 3500 }, { day: 80, loanNeed: 0, cumulative: 10000 }];
  const result = pricing({ fundingCloseMode: 'scheduled', fundingInterestMode: 'monthly_full',
    fundingPrincipalMonthly: 20000, fundingTermMonths: 3 }, timeline, 80);
  assert.equal(result.repaymentReserveGap, 0);
  assert.equal(result.tradeFundingGap, 22400);
  assert.equal(pricing({ fundingCloseMode: 'scheduled', fundingInterestMode: 'monthly_full',
    fundingPrincipalMonthly: 20000, fundingTermMonths: 3, fundingRepaymentReserve: 22400 }, timeline, 80).tradeFundingGap, 0);
});

test('initial commission base includes minimum issuance even with mostly own funding and early closing', () => {
  const timeline = [{ day: 0, loanNeed: 1000, cumulative: -1000 },
    { day: 7, loanNeed: 0, cumulative: 100000 }];
  const result = pricing({ fundingInterestMode: 'monthly_full', fundingMonthlyBase: 'initial',
    fundingMonthlyRate: 2, fundingLoanMin: 50000 }, timeline, 7);
  assert.equal(result.amount, 50000);
  assert.equal(result.creditInterest, 1000);
  assert.equal(result.periods[0].base, 50000);
});

test('the first upfront balance commission matches the amount actually withheld at minimum issuance', () => {
  const timeline = [{ day: 0, loanNeed: 1000, cumulative: -1000 },
    { day: 7, loanNeed: 0, cumulative: 100000 }];
  const result = pricing({ fundingInterestMode: 'monthly_full', fundingMonthlyBase: 'balance',
    fundingMonthlyUpfront: true, fundingMonthlyRate: 2, fundingLoanMin: 50000 }, timeline, 7);
  assert.equal(result.amount, 50000);
  assert.equal(result.firstFee, 1000);
  assert.equal(result.creditInterest, result.firstFee);
  assert.equal(result.repaymentSchedule[0].interest, result.firstFee);
});
