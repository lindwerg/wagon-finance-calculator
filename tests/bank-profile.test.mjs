import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, minimumMarkup } from '../finance.mjs';
import { ALT_DEFAULTS, selectFundingProfile } from '../profiles.mjs';
import { LINE_PROFILE, TOCHKA_PROFILE, tochkaAlternative, BILLING_PAIRS } from '../bank-profile.mjs';

const initial = () => ({ ...DEFAULTS, ...ALT_DEFAULTS, ...LINE_PROFILE, ...tochkaAlternative() });

test('VKL and personal flat commission loan own independent complete billing profiles', () => {
  const line = { ...initial(), fundingRate: 21.375, fundingLimit: 140000, fundingRepaymentReserve: 777 };
  const tochka = selectFundingProfile(line, 'credit');
  assert.equal(tochka.fundingMonthlyRate, 2.49);
  assert.equal(tochka.fundingMonthlyUpfront, true);
  assert.equal(tochka.fundingCloseMode, 'scheduled');
  assert.equal(tochka.fundingLimit, 0);
  assert.equal(tochka.fundingScheduleConfirmed, false);
  assert.equal(tochka.fundingRepaymentReserve, 0);
  assert.deepEqual(selectFundingProfile(tochka, 'line'), line);
  assert.equal(BILLING_PAIRS.length, 14);
});
test('switching the product preserves all fourteen billing fields and separate limits', () => {
  const input = initial();
  const switched = selectFundingProfile(input, 'credit');
  for (const [primary, alternative] of BILLING_PAIRS) assert.equal(switched[primary], input[alternative]);
  const off = selectFundingProfile(switched, 'none');
  assert.equal(off.primaryFundingKind, 'credit');
  assert.deepEqual(selectFundingProfile(off, 'credit'), switched);
});
test('the example line and personal monthly loan do not force the same markup', () => {
  const line = initial();
  assert.equal(minimumMarkup(line, 2000).markup, 5330);
  assert.equal(minimumMarkup({ ...line, factorEnabled: true }, 2000).markup, 5140);
  assert.equal(minimumMarkup({ ...line, ...TOCHKA_PROFILE }, 2000).markup, 12310);
});
test('all five selected targets are reached after bank and company overhead', () => {
  for (const target of [1000, 2000, 3000, 4000, 5000]) {
    const quote = minimumMarkup(initial(), target);
    assert.ok(quote.profit >= target);
  }
});
