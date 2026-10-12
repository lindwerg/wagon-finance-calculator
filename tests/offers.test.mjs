import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, calculate } from '../finance.mjs';
import { buildOffers } from '../offers.mjs';
import { schemeTable } from '../recommend.mjs';

const find = (comparison, id) => comparison.offers.find(offer => offer.id === id);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `Ожидалось ${expected}, получено ${actual}`);

test('default target quotes distinguish ordinary credit and credit with useful factoring', () => {
  const comparison = buildOffers(DEFAULTS);
  const credit = find(comparison, 'credit');
  const factor = find(comparison, 'credit-factor');
  assert.equal(comparison.selected.id, 'current');
  assert.equal(comparison.targetProfit, 2000);
  assert.equal(comparison.selected.quote.price, credit.quote.price);
  assert.ok(factor.quote.price < credit.quote.price);
  assert.equal(factor.factorUseful, true);
  assert.ok(credit.quoteResult.profit >= 2000);
  assert.ok(factor.quoteResult.profit >= 2000);
  assert.equal(comparison.offers.some(offer => offer.id === 'current'), false);
});

test('switching products never changes the entered client price, while target quotes change', () => {
  const input = { ...DEFAULTS, markup: 8000, fundingLimit: 150000, factorConfirmed: true };
  const comparison = buildOffers(input);
  for (const offer of [comparison.selected, ...comparison.offers]) {
    assert.equal(offer.currentResult.invoiceGross, 108000);
    assert.equal(offer.params.markup, 8000);
    assert.equal(offer.quoteResult.invoiceGross, offer.quote.price);
    assert.equal(offer.quoteResult.markupNet, offer.quote.markup / 1.22);
  }
  assert.notEqual(find(comparison, 'credit').quote.price, find(comparison, 'credit-factor').quote.price);
  assert.equal(input.markup, 8000);
});

test('seven- and fourteen-day payment before acceptance gives no variable factoring benefit', () => {
  for (const clientDays of [7, 14]) {
    const comparison = buildOffers({ ...DEFAULTS, clientDays, acceptanceDay: 20,
      fundingLimit: 150000, factorFeePercent: 5, factorFixed: 9000 });
    const credit = find(comparison, 'credit');
    const factor = find(comparison, 'credit-factor');
    assert.equal(factor.factorUseful, false);
    assert.equal(factor.quote.price, credit.quote.price);
    assert.equal(factor.currentResult.factorFeeNet, 0);
    assert.equal(factor.bankCostCurrent, credit.bankCostCurrent);
    assert.equal(comparison.bestAvailable.id, 'credit');
    assert.match(factor.factorUnusedReason, new RegExp(`Клиент платит через ${clientDays} дней, фактор — через 20`));
    assert.match(factor.factorUnusedReason, /не ускоряет деньги/);
  }
});

test('unused factoring subscription remains a cost and increases the target quote', () => {
  const comparison = buildOffers({ ...DEFAULTS, clientDays: 7, fundingLimit: 150000,
    factorMonthly: 120000, factorMonthlyVolume: 1200 });
  const credit = find(comparison, 'credit');
  const factor = find(comparison, 'credit-factor');
  assert.equal(factor.factorUseful, false);
  close(factor.bankCostCurrent - credit.bankCostCurrent, 100);
  assert.ok(factor.quote.price > credit.quote.price);
  assert.match(factor.factorUnusedReason, /Абонентская плата факторинга сохраняется/);
});

test('seven days from acceptance means client payment on day twenty-seven and useful factoring', () => {
  const comparison = buildOffers({ ...DEFAULTS, clientDays: 7, delayAnchor: 'acceptance',
    acceptanceDay: 20, factorConfirmed: true, fundingLimit: 150000 });
  const factor = find(comparison, 'credit-factor');
  assert.equal(factor.quoteResult.paymentDay, 27);
  assert.equal(factor.quoteResult.factorDay, 20);
  assert.equal(factor.factorUseful, true);
  assert.equal(factor.factorUnusedReason, '');
  assert.ok(factor.quoteResult.factorFeeNet > 0);
});

test('limit readiness uses the target quote including its higher upfront insurance premium', () => {
  const input = { ...DEFAULTS, markup: 0, insuranceEnabled: true, fundingLimit: 100500 };
  const comparison = buildOffers(input, 20000, { risk: 'new', insuranceConfirmed: true });
  const insuredCredit = find(comparison, 'credit-insurance');
  assert.equal(insuredCredit.currentResult.uncoveredGap, 0);
  assert.equal(insuredCredit.executionReadyQuote, false);
  assert.ok(insuredCredit.quote.price > 120000);
  assert.ok(insuredCredit.needBeforeClient > 100500);
  assert.equal(insuredCredit.needBeforeClient, insuredCredit.quoteResult.peakFundingNeed);
  assert.ok(insuredCredit.quoteResult.uncoveredGap > 0);
  assert.equal(comparison.bestAvailable, null);
  assert.ok(comparison.bestCalculated);
});

test('own cash at the entered price cannot hide the premium gap of the target quote', () => {
  const comparison = buildOffers({ ...DEFAULTS, markup: 0, insuranceEnabled: true,
    ownCash: 100500 }, 20000, { risk: 'new', insuranceConfirmed: true });
  const ownMoney = find(comparison, 'cash-insurance');
  assert.equal(ownMoney.currentResult.executionReady, true);
  assert.equal(ownMoney.executionReadyQuote, false);
  assert.equal(comparison.compactOffers.some(offer => offer.id === 'cash-insurance'), false);
  assert.notEqual(comparison.bestCalculated.params.fundingKind, 'none');
});

test('independent zero-interest overdraft wins only using its own confirmed limit and fees', () => {
  const input = { ...DEFAULTS, clientDays: 7, fundingLimit: 150000, fundingFeeFixed: 3000 };
  const alternativeFunding = { fundingKind: 'overdraft', fundingRate: 0,
    fundingFeePercent: 0, fundingFeeFixed: 0, fundingMonthly: 12000,
    fundingMonthlyVolume: 1200, fundingLimit: 100000 };
  const comparison = buildOffers(input, 2000, { alternativeFunding });
  assert.equal(comparison.bestAvailable.id, 'alternative');
  assert.equal(comparison.bestAvailable.currentResult.breakdown.subscriptions, 10);
  assert.equal(comparison.bestAvailable.params.fundingFeeFixed, 0);
  assert.equal(comparison.bestAvailable.params.fundingLimit, 100000);
  const unavailable = buildOffers(input, 2000,
    { alternativeFunding: { ...alternativeFunding, fundingLimit: 99999 } });
  assert.equal(find(unavailable, 'alternative').executionReadyQuote, false);
  assert.equal(unavailable.bestAvailable.id, 'credit');
  assert.equal(unavailable.bestCalculated.id, 'alternative');
});

test('risky clients without approved protection have no recommended available or calculated quote', () => {
  for (const risk of ['new', 'late']) {
    const comparison = buildOffers({ ...DEFAULTS, fundingLimit: 150000 }, 2000, { risk });
    assert.equal(comparison.bestAvailable, null);
    assert.equal(comparison.bestCalculated, null);
    assert.equal(comparison.noProtection, true);
    assert.equal(comparison.offers.some(offer => offer.riskSuitable), false);
  }
});

test('confirmed nonrecourse factoring covers customer risk only when it is used', () => {
  const input = { ...DEFAULTS, factorConfirmed: true, factorRecourse: false, fundingLimit: 150000 };
  const useful = buildOffers(input, 2000, { risk: 'new' });
  assert.equal(useful.bestAvailable.id, 'credit-factor');
  assert.equal(find(useful, 'credit-factor').riskSuitable, true);
  const unused = buildOffers({ ...input, clientDays: 7 }, 2000, { risk: 'new' });
  assert.equal(find(unused, 'credit-factor').riskSuitable, false);
  assert.equal(unused.bestAvailable, null);
  assert.equal(unused.bestCalculated, null);
});

test('full customer advance protects risk and funds a cash quote', () => {
  const comparison = buildOffers({ ...DEFAULTS, advancePercent: 100 }, 2000, { risk: 'late' });
  assert.equal(comparison.bestAvailable.id, 'cash');
  assert.equal(comparison.bestAvailable.needBeforeClient, 0);
  assert.equal(comparison.noProtection, false);
});

test('a cash-factor scheme with no starting money never becomes a bank candidate', () => {
  const comparison = buildOffers(DEFAULTS);
  assert.equal(find(comparison, 'cash-factor').quoteResult.uncoveredGap, 100000);
  assert.equal(comparison.bestAvailable, null);
  assert.notEqual(comparison.bestCalculated.params.fundingKind, 'none');
  assert.equal(comparison.compactOffers.some(offer => offer.params.fundingKind === 'none'), false);
});

test('own money with approved insurance beats an expensive unnecessary loan', () => {
  const comparison = buildOffers({ ...DEFAULTS, ownCash: 150000, fundingMonthly: 12000,
    fundingMonthlyVolume: 10, fundingFeeFixed: 3000 }, 2000,
  { risk: 'new', insuranceConfirmed: true });
  assert.equal(comparison.bestAvailable.id, 'cash-insurance');
  assert.equal(comparison.bestAvailable.params.factorEnabled, false);
  assert.ok(comparison.bestAvailable.quote.price < find(comparison, 'credit-insurance').quote.price);
  assert.ok(comparison.compactOffers.some(offer => offer.id === 'cash-insurance'));
  assert.ok(comparison.compactOffers.length <= 5);
});

test('compact bank comparisons keep matching insurance and show the best funded cash variant within five cards', () => {
  const comparison = buildOffers({ ...DEFAULTS, ownCash: 150000, insuranceEnabled: true }, 2000,
    { alternativeFunding: { fundingKind: 'overdraft', fundingRate: 15, fundingLimit: 150000 } });
  assert.deepEqual(comparison.compactOffers.map(offer => offer.id),
    ['credit-insurance', 'credit-factor-insurance', 'alternative-insurance', 'alternative-factor-insurance', 'cash']);
  assert.equal(new Set(comparison.compactOffers.map(offer => offer.id)).size, comparison.compactOffers.length);
});

test('unknown primary funding terms stay excluded while the selected calculation remains visible', () => {
  const comparison = buildOffers({ ...DEFAULTS, fundingTermsKnown: false }, 2000,
    { alternativeFunding: { fundingKind: 'overdraft', fundingRate: 0, fundingLimit: 150000 } });
  assert.equal(comparison.selected.currentResult.invoiceGross, 105000);
  assert.equal(comparison.offers.some(offer => offer.id.startsWith('credit')), false);
  assert.equal(comparison.bestAvailable.id, 'alternative');
});

test('bank cost excludes overhead and the target quote retains the finance profit definition', () => {
  const comparison = buildOffers({ ...DEFAULTS, factorEnabled: true, insuranceEnabled: true,
    fundingFeeFixed: 1000, fundingMonthly: 12000 }, 2000);
  const selected = comparison.selected;
  const totalCost = Object.values(selected.currentResult.breakdown).reduce((sum, value) => sum + value, 0);
  close(selected.bankCostCurrent, totalCost - selected.currentResult.overheadPerWagon);
  close(selected.quoteResult.profit, calculate({ ...selected.params, markup: selected.quote.markup }).profit);
  assert.ok(selected.quoteResult.profit >= 2000);
});

test('target rejects negative, nonnumeric and nonfinite input; large finite targets return null quotes', () => {
  for (const target of [-1, NaN, Infinity, '2000', null]) {
    assert.throws(() => buildOffers(DEFAULTS, target), RangeError);
  }
  assert.ok(buildOffers(DEFAULTS, 0).selected.quote);
  const unreachable = buildOffers(DEFAULTS, 1000000);
  assert.equal(unreachable.selected.quote, null);
  assert.equal(unreachable.selected.quoteResult, null);
  assert.equal(unreachable.selected.executionReadyQuote, false);
  assert.equal(unreachable.selected.needBeforeClient, null);
  assert.equal(unreachable.bestAvailable, null);
  assert.equal(unreachable.bestCalculated, null);
});

test('a bank amount above the product maximum cannot be a calculated borrowing candidate', () => {
  const comparison = buildOffers({ ...DEFAULTS, fundingLimit: 150000,
    fundingInterestMode: 'monthly_full', fundingMonthlyRate: 2.49,
    fundingMonthlyBase: 'initial', fundingMonthlyUpfront: true, fundingCloseMode: 'scheduled',
    fundingPrincipalMode: 'equal', fundingTermMonths: 3, fundingLoanMax: 102000 });
  assert.ok(find(comparison, 'credit').quoteResult.peakBankLoan > 102000);
  assert.equal(comparison.bestAvailable, null);
  assert.equal(comparison.bestCalculated, null);
});

const upfrontOffer = { ...DEFAULTS, fundingInterestMode: 'monthly_full', fundingMonthlyRate: 2.49,
  fundingMonthlyBase: 'initial', fundingMonthlyUpfront: true, fundingCloseMode: 'scheduled',
  fundingPrincipalMode: 'equal', fundingTermMonths: 3, fundingLoanMin: 50000,
  fundingLoanMax: 27510000, fundingLimit: 0, fundingRepaymentReserve: 0,
  fundingEarlyConfirmed: false, fundingScheduleConfirmed: false, clientDays: 45 };

test('a conditional flat monthly loan needs factoring to fund its pre-client schedule without a reserve', () => {
  const comparison = buildOffers(upfrontOffer);
  const credit = find(comparison, 'credit');
  const factor = find(comparison, 'credit-factor');
  assert.equal(comparison.bestAvailable, null);
  assert.equal(comparison.bestCalculated.id, 'credit-factor');
  assert.ok(credit.quoteResult.creditPricing.repaymentReserveGap > 0);
  assert.equal(factor.quoteResult.creditPricing.repaymentReserveGap, 0);
  assert.equal(factor.quoteResult.creditPricing.tradeFundingGap, 0);
  assert.equal(factor.quoteResult.uncoveredGap, factor.quoteResult.peakBankLoan);
  assert.equal(factor.params.fundingScheduleConfirmed, false);
  assert.equal(factor.executionReadyQuote, false);
  assert.ok(factor.quote.price > credit.quote.price);
  close(factor.quoteResult.creditInterest, credit.quoteResult.creditInterest);
});

test('seven-day customer cash funds the flat monthly schedule and ordinary credit is the conditional candidate', () => {
  const comparison = buildOffers({ ...upfrontOffer, clientDays: 7 });
  const credit = find(comparison, 'credit');
  const factor = find(comparison, 'credit-factor');
  assert.equal(comparison.bestAvailable, null);
  assert.equal(comparison.bestCalculated.id, 'credit');
  assert.equal(credit.quoteResult.creditPricing.repaymentsBeforeClient, credit.quoteResult.creditPricing.firstFee);
  assert.equal(credit.quoteResult.creditPricing.repaymentReserveGap, 0);
  assert.equal(credit.quoteResult.creditPricing.tradeFundingGap, 0);
  assert.equal(factor.factorUseful, false);
  assert.equal(factor.quote.price, credit.quote.price);
});

test('a forty-thousand separate reserve makes cheaper ordinary credit the forty-five-day candidate', () => {
  const comparison = buildOffers({ ...upfrontOffer, fundingRepaymentReserve: 40000 });
  const credit = find(comparison, 'credit');
  const factor = find(comparison, 'credit-factor');
  assert.equal(comparison.bestAvailable, null);
  assert.equal(comparison.bestCalculated.id, 'credit');
  assert.equal(credit.quoteResult.creditPricing.repaymentReserveGap, 0);
  assert.equal(credit.quoteResult.creditPricing.tradeFundingGap, 0);
  assert.ok(credit.quote.price < factor.quote.price);
});

test('an enabled factor arriving after customer cash keeps its subscription but cannot improve the candidate', () => {
  const comparison = buildOffers({ ...upfrontOffer, factorEnabled: true, clientDays: 7,
    factorMonthly: 120000, factorMonthlyVolume: 1200 });
  const credit = find(comparison, 'credit');
  const factor = find(comparison, 'credit-factor');
  assert.equal(comparison.bestCalculated.id, 'credit');
  assert.equal(comparison.selected.factorUseful, false);
  assert.equal(factor.factorUseful, false);
  assert.equal(factor.quoteResult.creditPricing.repaymentReserveGap, 0);
  close(factor.bankCostCurrent - credit.bankCostCurrent, 100);
  assert.ok(factor.quote.price > credit.quote.price);
  assert.match(factor.factorUnusedReason, /не ускоряет деньги/);
  assert.match(factor.factorUnusedReason, /Абонентская плата факторинга сохраняется/);
});

test('no calculated candidate is offered when all bank schemes leave a trade gap between instalments', () => {
  const comparison = buildOffers({ ...DEFAULTS, fundingCloseMode: 'scheduled',
    fundingInterestMode: 'monthly_full', fundingPrincipalMonthly: 20000, fundingTermMonths: 3,
    fundingFeeFixed: 20000, supplierDay: 50, clientDays: 80, factorEnabled: true,
    factorConfirmed: true, acceptanceDay: 55, factorAdvancePercent: 95, factorRate: 0,
    fundingLimit: 200000, markup: 30000 });
  const factor = find(comparison, 'credit-factor');
  assert.equal(factor.quoteResult.creditPricing.repaymentReserveGap, 0);
  assert.ok(factor.quoteResult.creditPricing.tradeFundingGap > 0);
  assert.equal(comparison.bestAvailable, null);
  assert.equal(comparison.bestCalculated, null);
});

test('annual line and the alternative upfront monthly loan retain independent tariffs limits and target prices', () => {
  const input = { ...DEFAULTS, fundingKind: 'line', primaryFundingKind: 'line', clientDays: 30,
    fundingRate: 23.5, fundingLimit: 150000, factorConfirmed: true };
  const alternativeFunding = { fundingKind: 'credit', fundingRate: 0, fundingLimit: 0,
    fundingInterestMode: 'monthly_full', fundingMonthlyRate: 2.49, fundingMonthlyBase: 'initial',
    fundingMonthlyUpfront: true, fundingCloseMode: 'scheduled', fundingPrincipalMode: 'equal',
    fundingTermMonths: 3, fundingLoanMin: 50000, fundingLoanMax: 27510000,
    fundingEarlyConfirmed: false, fundingScheduleConfirmed: false };
  const comparison = buildOffers(input, 2000, { alternativeFunding });
  const line = find(comparison, 'credit');
  const factor = find(comparison, 'credit-factor');
  const termLoan = find(comparison, 'alternative');
  assert.equal(line.label, 'ВКЛ');
  assert.equal(factor.label, 'ВКЛ + факторинг');
  assert.equal(line.params.fundingKind, 'line');
  assert.equal(line.params.fundingInterestMode, 'annual_daily');
  assert.equal(line.params.fundingRate, 23.5);
  assert.equal(line.params.fundingLimit, 150000);
  assert.equal(line.quote.markup, 5330);
  assert.equal(factor.quote.markup, 5140);
  assert.equal(termLoan.params.fundingKind, 'credit');
  assert.equal(termLoan.params.fundingInterestMode, 'monthly_full');
  assert.equal(termLoan.params.fundingMonthlyRate, 2.49);
  assert.equal(termLoan.params.fundingMonthlyBase, 'initial');
  assert.equal(termLoan.params.fundingRate, 0);
  assert.equal(termLoan.params.fundingLimit, 0);
  assert.equal(termLoan.quote.markup, 12310);
  assert.equal(line.executionReadyQuote, true);
  assert.equal(termLoan.executionReadyQuote, false);
  assert.equal(comparison.bestAvailable.id, 'credit-factor');
});

test('line identity supplies the primary and selected labels even without explicit primary metadata', () => {
  const input = { ...DEFAULTS, fundingKind: 'line', clientDays: 30 };
  const comparison = buildOffers(input);
  assert.equal(comparison.selected.label, 'Ваша схема: ВКЛ');
  assert.equal(find(comparison, 'credit').params.fundingKind, 'line');
  assert.equal(find(comparison, 'credit').label, 'ВКЛ');
  const unknown = buildOffers({ ...input, fundingTermsKnown: false });
  assert.equal(unknown.selected.label, 'Ваша схема: ВКЛ');
  const table = schemeTable(input);
  assert.equal(table.find(row => row.id === 'credit').label, 'ВКЛ');
  assert.equal(table.find(row => row.id === 'credit-factor').label, 'ВКЛ + факторинг');
});

test('compact comparison keeps the monthly alternative with factoring even when an annual line wins', () => {
  const input = { ...DEFAULTS, fundingKind: 'line', primaryFundingKind: 'line', clientDays: 45 };
  const alternativeFunding = { fundingKind: 'credit', fundingInterestMode: 'monthly_full',
    fundingMonthlyRate: 2.49, fundingMonthlyBase: 'initial', fundingMonthlyUpfront: true,
    fundingCloseMode: 'scheduled', fundingPrincipalMode: 'equal', fundingTermMonths: 3,
    fundingLoanMin: 50000, fundingLoanMax: 27510000, fundingLimit: 0,
    fundingEarlyConfirmed: false, fundingScheduleConfirmed: false };
  const comparison = buildOffers(input, 2000, { alternativeFunding });
  assert.equal(comparison.bestCalculated.params.fundingKind, 'line');
  assert.deepEqual(comparison.compactOffers.map(offer => offer.id),
    ['credit', 'credit-factor', 'alternative', 'alternative-factor']);
  const termLoan = find(comparison, 'alternative');
  const termFactor = find(comparison, 'alternative-factor');
  assert.ok(termFactor.quote.price > termLoan.quote.price);
  close(termFactor.quoteResult.creditInterest, termLoan.quoteResult.creditInterest);
  assert.ok(termLoan.quoteResult.creditPricing.repaymentReserveGap > 0);
  assert.equal(termFactor.quoteResult.creditPricing.repaymentReserveGap, 0);
});

test('a protected own-money winner replaces the unprotected cash slot without dropping bank comparisons', () => {
  const comparison = buildOffers({ ...DEFAULTS, ownCash: 150000 }, 2000,
    { risk: 'new', insuranceConfirmed: true,
      alternativeFunding: { fundingKind: 'overdraft', fundingRate: 0, fundingLimit: 0 } });
  assert.equal(comparison.bestAvailable.id, 'cash-insurance');
  assert.deepEqual(comparison.compactOffers.map(offer => offer.id),
    ['credit', 'credit-factor', 'alternative', 'alternative-factor', 'cash-insurance']);
  assert.equal(comparison.compactOffers.length, 5);
  assert.equal(comparison.compactOffers.at(-1).riskSuitable, true);
  assert.equal(comparison.compactOffers.some(offer => offer.id === 'cash'), false);
});
