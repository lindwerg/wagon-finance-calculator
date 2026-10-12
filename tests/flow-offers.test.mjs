import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../finance.mjs';
import { ALT_DEFAULTS } from '../profiles.mjs';
import { LINE_PROFILE, tochkaAlternative, TOCHKA_PROFILE } from '../bank-profile.mjs';
import { FLOW_DEFAULTS } from '../portfolio.mjs';
import { buildFlowOffers } from '../flow-offers.mjs';
const initial = () => ({ ...DEFAULTS, ...ALT_DEFAULTS, ...LINE_PROFILE, ...tochkaAlternative(), ...FLOW_DEFAULTS });
const alternative = () => ({ ...TOCHKA_PROFILE, fundingKind: 'credit', fundingLimit: 0, fundingRate: 23.5 });

test('same plan compares four sources without allocating a new loan to every wagon', () => {
  const result = buildFlowOffers(initial(), 2000, { alternativeFunding: alternative() });
  assert.equal(result.compactOffers.length, 4);
  const credit = result.offers.find(offer => offer.id === 'alternative');
  const factor = result.offers.find(offer => offer.id === 'alternative-factor');
  assert.ok(Math.abs(credit.currentResult.creditInterest - 7470) < 1e-7);
  assert.ok(Math.abs(credit.currentResult.creditInterest / credit.currentResult.totalWagons - 830) < 1e-7);
  assert.equal(factor.currentResult.creditInterest, credit.currentResult.creditInterest);
  assert.ok(credit.quote.profit >= 2000);
  assert.equal(result.bestAvailable, null);
  assert.equal(result.bestCalculated, null);
});
test('a low economic price does not recommend a cash-deficient constant flow', () => {
  const result = buildFlowOffers({ ...initial(), flowMonthlyVolume: 10 }, 1000, { alternativeFunding: alternative() });
  assert.ok(result.offers.every(offer => offer.quoteResult.cash.externalGap > 0));
  assert.equal(result.bestAvailable, null);
  assert.equal(result.bestCalculated, null);
});
test('a funded and confirmed plan can be recommended by target price', () => {
  const result = buildFlowOffers({ ...initial(), ownCash: 1000000, fundingLimit: 100000 }, 2000,
    { alternativeFunding: { ...alternative(), fundingLimit: 100000, fundingScheduleConfirmed: true } });
  assert.ok(result.bestAvailable);
  assert.equal(result.bestAvailable.quoteResult.cash.externalGap, 0);
  assert.equal(result.bestAvailable.executionReadyQuote, true);
});
test('a doubtful client is not recommended unsecured; an approved policy changes eligibility', () => {
  const p = { ...initial(), ownCash: 1000000, fundingLimit: 100000 };
  const unsecured = buildFlowOffers(p, 2000, { risk: 'new', alternativeFunding: alternative() });
  assert.equal(unsecured.noProtection, true);
  assert.equal(unsecured.bestAvailable, null);
  const protectedPlan = buildFlowOffers({ ...p, insuranceEnabled: true }, 2000,
    { risk: 'new', insuranceConfirmed: true, alternativeFunding: alternative() });
  assert.ok(protectedPlan.bestAvailable);
});
test('unsupported alternative billing is shown as unavailable without corrupting current plan', () => {
  const result = buildFlowOffers(initial(), 2000, { alternativeFunding: { ...alternative(), fundingInterestMode: 'monthly_daily' } });
  assert.ok(result.selected.quote);
  assert.equal(result.offers.find(offer => offer.id === 'alternative').quote, null);
  assert.match(result.offers.find(offer => offer.id === 'alternative').error, /планового графика/);
});
test('explicit own-money mode produces no fixed loan fee and remains a comparable option', () => {
  const result = buildFlowOffers({ ...initial(), fundingKind: 'none', ownCash: 1000000 }, 2000);
  assert.equal(result.selected.currentResult.creditInterest, 0);
  assert.ok(result.offers.some(offer => offer.id === 'cash'));
  assert.equal(result.bestAvailable.params.fundingKind, 'none');
});
test('the same own cash always competes with a needless paid loan and ignores bank term confirmation', () => {
  const result = buildFlowOffers({ ...initial(), ...TOCHKA_PROFILE, primaryFundingKind: 'credit', fundingKind: 'credit',
    flowLoanAmount: 200000, ownCash: 1000000, fundingFeePercent: 1, fundingScheduleConfirmed: true, fundingLimit: 200000, fundingTermsKnown: false }, 2000);
  assert.equal(result.bestAvailable.params.fundingKind, 'none');
  assert.equal(result.bestAvailable.quoteResult.cash.externalGap, 0);
  assert.ok(result.bestAvailable.quote.price < result.selected.quote.price);
});
test('fixed credit below minimum or above maximum is never the quoted winner', () => {
  for (const flowLoanAmount of [40000, 30000000]) {
    const result = buildFlowOffers({ ...initial(), ...TOCHKA_PROFILE, primaryFundingKind: 'credit', fundingKind: 'credit',
      flowLoanAmount, fundingLimit: flowLoanAmount, ownCash: 500000, fundingScheduleConfirmed: true }, 2000);
    assert.equal(result.offers.find(offer => offer.id === 'credit').contractEligible, false);
    assert.notEqual(result.bestCalculated?.params.fundingKind, 'credit');
    assert.notEqual(result.bestAvailable?.params.fundingKind, 'credit');
  }
});
