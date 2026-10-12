import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, calculate } from '../finance.mjs';
import { recommend } from '../recommend.mjs';
import { ALT_DEFAULTS, selectFundingProfile } from '../profiles.mjs';

test('zero working capital does not produce an unfinanced cash-factor bank recommendation', () => {
  const advice = recommend(DEFAULTS);
  assert.equal(advice.best, null);
  assert.ok(advice.candidate);
  assert.notEqual(advice.candidate.params.fundingKind, 'none');
  assert.equal(advice.candidate.result.executionReady, false);
});
test('own money plus approved insurance beats an expensive unnecessary credit for a new customer', () => {
  const input = { ...DEFAULTS, ownCash: 150000, fundingMonthly: 12000, fundingMonthlyVolume: 10, fundingFeeFixed: 3000 };
  const advice = recommend(input, 'new', true);
  assert.equal(advice.best.params.fundingKind, 'none');
  assert.equal(advice.best.params.insuranceEnabled, true);
  assert.equal(advice.best.params.factorEnabled, false);
  assert.ok(advice.best.result.profit > 3000);
  assert.equal(advice.best.result.profit, calculate({ ...input, fundingKind: 'none', insuranceEnabled: true }).profit);
});
test('late and doubtful clients receive no uninsured unsecured recommendation', () => {
  for (const risk of ['late', 'new']) {
    const advice = recommend({ ...DEFAULTS, fundingLimit: 150000 }, risk, false);
    assert.equal(advice.best, null);
    assert.equal(advice.candidate, null);
    assert.equal(advice.noProtection, true);
  }
});
test('a confirmed nonrecourse factor needs initial funding, despite coverage after acceptance', () => {
  const noMoney = recommend({ ...DEFAULTS, factorConfirmed: true, factorRecourse: false }, 'new');
  assert.equal(noMoney.best, null);
  assert.ok(noMoney.candidate.result.factorUsed);
  const funded = recommend({ ...DEFAULTS, fundingLimit: 150000, factorConfirmed: true, factorRecourse: false }, 'new');
  assert.ok(funded.best.result.factorUsed);
  assert.equal(funded.best.result.executionReady, true);
});
test('seven-day client payment excludes unnecessary variable factoring; monthly fee still matters', () => {
  const advice = recommend({ ...DEFAULTS, clientDays: 7, fundingLimit: 150000, factorMonthly: 10000 });
  assert.equal(advice.best.params.factorEnabled, false);
  assert.equal(advice.best.params.fundingKind, 'credit');
});
test('independently entered overdraft can win, but its own limit must cover the order', () => {
  const input = { ...DEFAULTS, clientDays: 7, fundingLimit: 150000 };
  const alternative = { fundingKind: 'overdraft', fundingRate: 0, fundingMonthly: 12000, fundingMonthlyVolume: 1200, fundingLimit: 150000 };
  const advice = recommend(input, 'reliable', false, alternative);
  assert.equal(advice.best.params.fundingKind, 'overdraft');
  assert.equal(advice.best.result.breakdown.subscriptions, 10);
  const unavailable = recommend(input, 'reliable', false, { ...alternative, fundingLimit: 0 });
  assert.equal(unavailable.best.params.fundingKind, 'credit');
});
test('switching credit to overdraft swaps whole owned tariff tuples, never approvals', () => {
  const input = { ...DEFAULTS, ...ALT_DEFAULTS, fundingLimit: 150000, fundingRate: 23.5, fundingFeeFixed: 3000, fundingMonthly: 12000, fundingMonthlyVolume: 10,
    altKnown: true, altRate: 15, altLimit: 0, altFeeFixed: 900, altMonthly: 5000, altMonthlyVolume: 20 };
  const switched = selectFundingProfile(input, 'overdraft');
  assert.equal(switched.fundingLimit, 0);
  assert.equal(switched.fundingRate, 15);
  assert.equal(switched.fundingFeeFixed, 900);
  assert.equal(switched.fundingMonthly, 5000);
  assert.equal(switched.fundingMonthlyVolume, 20);
  assert.equal(switched.altLimit, 150000);
  assert.equal(calculate(switched).executionReady, false);
  const back = selectFundingProfile(switched, 'credit');
  assert.deepEqual(back, input);
});
test('turning off overdraft preserves its profile identity and does not rename the credit approval', () => {
  const input = { ...DEFAULTS, ...ALT_DEFAULTS, fundingKind: 'overdraft', primaryFundingKind: 'overdraft', fundingRate: 12, fundingLimit: 0, altKnown: true, altRate: 25, altLimit: 180000 };
  const off = selectFundingProfile(input, 'none');
  assert.equal(off.primaryFundingKind, 'overdraft');
  assert.equal(off.altLimit, 180000);
  const advice = recommend(off, 'reliable', false, { fundingKind: 'credit', fundingRate: off.altRate, fundingLimit: off.altLimit });
  assert.equal(advice.best.params.fundingKind, 'credit');
});
test('switching to an unknown product marks terms missing and keeps the previous approved profile', () => {
  const input = { ...DEFAULTS, ...ALT_DEFAULTS, fundingLimit: 150000 };
  const next = selectFundingProfile(input, 'overdraft');
  assert.equal(next.fundingTermsKnown, false);
  assert.equal(next.fundingLimit, 0);
  assert.equal(next.altLimit, 150000);
  assert.equal(next.altKnown, true);
});
