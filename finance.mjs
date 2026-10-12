/**
 * One-wagon economics and a netted, day-by-day operating cash schedule.
 * All input prices include VAT; bank fees are entered excluding their own VAT.
 * Default loan interest is simple, annual and paid after the last event.
 * Optional monthly modes and principal instalments use a separate reserve.
 */
import { priceCredit } from './credit-pricing.mjs';

export const DEFAULTS = Object.freeze({
  purchase: 100000, markup: 5000, vatPercent: 22, volume: 1200,
  monthlyOverhead: 515000, ownCash: 0,
  clientDays: 30, delayAnchor: 'payment', acceptanceDay: 20, lateDays: 0,
  supplierDay: 0, advancePercent: 0,
  fundingKind: 'credit', fundingRate: 23.5, fundingLimit: 0,
  fundingInterestMode: 'annual_daily', fundingMonthlyRate: 2,
  fundingMonthlyBase: 'balance', fundingMinimumMonths: 1,
  fundingCloseMode: 'on_client', fundingTermMonths: 3,
  fundingMonthlyUpfront: false, fundingPrincipalMode: 'fixed', fundingLoanMin: 0, fundingLoanMax: 0,
  fundingEarlyConfirmed: true,
  fundingScheduleConfirmed: true,
  fundingPrincipalMonthly: 0, fundingRepaymentReserve: 0,
  fundingFeePercent: 0, fundingFeeFixed: 0, fundingFeeVatPercent: 0,
  fundingMonthly: 0, fundingMonthlyVolume: 0,
  accountEnabled: false, accountMonthly: 0, accountVatPercent: 0,
  accountMonthlyVolume: 0,
  factorEnabled: false, factorUnavailable: false, factorRate: 17, factorRateBase: 'invoice',
  factorAdvancePercent: 95, factorDelay: 0, factorFeePercent: 0,
  factorFixed: 0, factorVatPercent: 0, factorMonthly: 0,
  factorMonthlyVolume: 0, factorUpfront: true, factorConfirmed: false,
  factorRecourse: true,
  insuranceEnabled: false, insurancePercent: 0.5,
  guaranteeEnabled: false, guaranteeRate: 0, guaranteeFeePercent: 0,
  guaranteeFixed: 0, guaranteeVatPercent: 0, guaranteeDays: 30,
  guaranteeCollateral: 0,
  lcEnabled: false, lcFeePercent: 0, lcFixed: 0, lcVatPercent: 0,
  lcCollateral: 0,
});

export const numericInputKeys = Object.freeze(
  Object.keys(DEFAULTS).filter((key) => typeof DEFAULTS[key] === 'number'),
);

const NAMES = {
  purchase: 'Закупочная цена', markup: 'Добавка к цене', vatPercent: 'НДС товара',
  volume: 'Месячное число вагонов', monthlyOverhead: 'Месячные расходы',
  ownCash: 'Собственные деньги', clientDays: 'Отсрочка клиента',
  acceptanceDay: 'День приёмки', lateDays: 'Просрочка клиента',
  supplierDay: 'День оплаты поставщику', advancePercent: 'Аванс клиента',
  fundingRate: 'Годовая ставка кредита', fundingLimit: 'Подтверждённый лимит',
  fundingMonthlyRate: 'Месячная ставка кредита', fundingMinimumMonths: 'Минимальное число оплачиваемых месяцев',
  fundingTermMonths: 'Срок кредитного графика',
  fundingLoanMin: 'Минимальная сумма выдачи кредита', fundingLoanMax: 'Максимальная сумма выдачи кредита',
  fundingPrincipalMonthly: 'Ежемесячное погашение тела кредита', fundingRepaymentReserve: 'Отдельный резерв для платежей банку',
  fundingFeePercent: 'Комиссия кредита', fundingFeeFixed: 'Разовая плата кредита',
  fundingFeeVatPercent: 'НДС комиссии кредита', fundingMonthly: 'Абонентская плата кредита',
  fundingMonthlyVolume: 'Число заявок по кредиту', accountMonthly: 'Плата за счёт',
  accountVatPercent: 'НДС платы за счёт', accountMonthlyVolume: 'Число заявок по счёту',
  factorRate: 'Годовая ставка факторинга', factorAdvancePercent: 'Выплата фактора',
  factorDelay: 'Задержка выплаты фактора', factorFeePercent: 'Разовая комиссия факторинга',
  factorFixed: 'Разовая плата факторинга', factorVatPercent: 'НДС факторинга',
  factorMonthly: 'Абонентская плата факторинга', factorMonthlyVolume: 'Число заявок по факторингу',
  insurancePercent: 'Разовая страховая премия', guaranteeRate: 'Годовая ставка гарантии',
  guaranteeFeePercent: 'Комиссия гарантии', guaranteeFixed: 'Разовая плата гарантии',
  guaranteeVatPercent: 'НДС гарантии', guaranteeDays: 'Срок гарантии',
  guaranteeCollateral: 'Залог гарантии', lcFeePercent: 'Комиссия аккредитива',
  lcFixed: 'Разовая плата аккредитива', lcVatPercent: 'НДС аккредитива',
  lcCollateral: 'Покрытие аккредитива',
};

const DAY_KEYS = ['clientDays', 'acceptanceDay', 'lateDays', 'supplierDay', 'factorDelay', 'guaranteeDays'];
const MONTHLY_VOLUME_KEYS = ['fundingMonthlyVolume', 'factorMonthlyVolume', 'accountMonthlyVolume'];
const ANNUAL_KEYS = ['fundingRate', 'factorRate', 'guaranteeRate'];
const PERCENT_KEYS = [
  'vatPercent', 'advancePercent', 'fundingFeeVatPercent',
  'accountVatPercent', 'factorAdvancePercent', 'factorVatPercent',
  'guaranteeVatPercent', 'lcVatPercent',
];
const BOOLEAN_KEYS = Object.keys(DEFAULTS).filter((key) => typeof DEFAULTS[key] === 'boolean');
const EPSILON = 1e-8;

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RangeError('Параметры расчёта должны быть объектом.');
  }
  const value = { ...DEFAULTS, ...input };
  for (const key of numericInputKeys) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      throw new RangeError(`${NAMES[key]}: введите конечное число.`);
    }
    if (key !== 'markup' && value[key] < 0) {
      throw new RangeError(`${NAMES[key]}: значение не может быть отрицательным.`);
    }
  }
  if (value.purchase <= 0) throw new RangeError('Закупочная цена должна быть больше нуля.');
  if (value.purchase + value.markup <= 0 || !Number.isFinite(value.purchase + value.markup)) {
    throw new RangeError('Цена клиенту должна быть конечным числом больше нуля.');
  }
  if (!Number.isInteger(value.volume) || value.volume < 1) {
    throw new RangeError('Месячное число вагонов должно быть целым числом от 1.');
  }
  for (const key of MONTHLY_VOLUME_KEYS) {
    if (!Number.isInteger(value[key])) throw new RangeError(`${NAMES[key]}: введите целое число от 0.`);
  }
  for (const key of DAY_KEYS) {
    if (!Number.isInteger(value[key]) || value[key] > 3650) {
      throw new RangeError(`${NAMES[key]}: введите целое число дней от 0 до 3650.`);
    }
  }
  for (const key of PERCENT_KEYS) {
    if (value[key] > 100) throw new RangeError(`${NAMES[key]}: процент должен быть от 0 до 100.`);
  }
  for (const key of ANNUAL_KEYS) {
    if (value[key] > 1000) throw new RangeError(`${NAMES[key]}: ставка должна быть от 0 до 1000% годовых.`);
  }
  if (value.fundingMonthlyRate > 1000) {
    throw new RangeError('Месячная ставка кредита: ставка должна быть от 0 до 1000% в месяц.');
  }
  for (const key of ['fundingMinimumMonths', 'fundingTermMonths']) {
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 120) {
      throw new RangeError(`${NAMES[key]}: введите целое число от 1 до 120.`);
    }
  }
  if (value.fundingLoanMax > 0 && value.fundingLoanMin > value.fundingLoanMax) {
    throw new RangeError('Минимальная сумма выдачи кредита не может превышать максимальную.');
  }
  if (value.fundingKind !== 'none' && value.fundingMonthlyUpfront && value.fundingInterestMode === 'monthly_daily') {
    throw new RangeError('Комиссия в начале месяца требует режима полного месячного периода.');
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof value[key] !== 'boolean') throw new RangeError(`${key}: укажите включено или выключено.`);
  }
  for (const [key, allowed] of [
    ['fundingKind', ['line', 'credit', 'overdraft', 'none']],
    ['fundingInterestMode', ['annual_daily', 'monthly_daily', 'monthly_full']],
    ['fundingMonthlyBase', ['balance', 'initial']],
    ['fundingCloseMode', ['on_client', 'scheduled']],
    ['fundingPrincipalMode', ['fixed', 'equal']],
    ['delayAnchor', ['payment', 'acceptance']],
    ['factorRateBase', ['invoice', 'advance']],
  ]) {
    if (!allowed.includes(value[key])) throw new RangeError(`Недопустимое значение параметра ${key}.`);
  }
  return value;
}

const grossFee = (net, vat) => net * (1 + vat / 100);
const cleanZero = (value) => Math.abs(value) < EPSILON ? 0 : value;

export function calculate(input = {}) {
  const p = normalize(input);
  const invoiceGross = p.purchase + p.markup;
  const dueDay = (p.delayAnchor === 'acceptance' ? p.acceptanceDay : 0) + p.clientDays;
  const paymentDay = dueDay + p.lateDays;
  const factorDay = p.acceptanceDay + p.factorDelay;
  const clientAdvance = invoiceGross * p.advancePercent / 100;
  const unpaidInvoice = invoiceGross - clientAdvance;
  const factorUsed = p.factorEnabled && !p.factorUnavailable && factorDay < paymentDay
    && unpaidInvoice > 0 && p.factorAdvancePercent > 0;
  const factorAdvance = factorUsed ? unpaidInvoice * p.factorAdvancePercent / 100 : 0;
  const factorDays = factorUsed ? paymentDay - factorDay : 0;
  const factorBase = p.factorRateBase === 'advance' ? factorAdvance : unpaidInvoice;
  const factorFeeNet = factorUsed
    ? factorBase * p.factorRate / 100 * factorDays / 365
      + unpaidInvoice * p.factorFeePercent / 100 + p.factorFixed
    : 0;
  const factorFeeGross = grossFee(factorFeeNet, p.factorVatPercent);
  const insuranceFee = p.insuranceEnabled ? invoiceGross * p.insurancePercent / 100 : 0;
  const guaranteeFeeNet = p.guaranteeEnabled
    ? invoiceGross * (p.guaranteeRate / 100 * p.guaranteeDays / 365 + p.guaranteeFeePercent / 100)
      + p.guaranteeFixed
    : 0;
  const guaranteeFeeGross = grossFee(guaranteeFeeNet, p.guaranteeVatPercent);
  const lcFeeNet = p.lcEnabled ? invoiceGross * p.lcFeePercent / 100 + p.lcFixed : 0;
  const lcFeeGross = grossFee(lcFeeNet, p.lcVatPercent);
  // The percentage setup fee is based on the purchase price, not on the loan limit.
  const fundingSetupNet = p.fundingKind !== 'none'
    ? p.purchase * p.fundingFeePercent / 100 + p.fundingFeeFixed : 0;
  const fundingSetupGross = grossFee(fundingSetupNet, p.fundingFeeVatPercent);
  const guaranteeCollateral = p.guaranteeEnabled ? p.guaranteeCollateral : 0;
  const lcCollateral = p.lcEnabled ? p.lcCollateral : 0;
  const lcApplied = Math.min(lcCollateral, p.purchase);
  const lcUnusedCoverage = lcCollateral - lcApplied;

  const subscriptions = [
    { enabled: p.fundingKind !== 'none', net: p.fundingMonthly, vat: p.fundingFeeVatPercent, volume: p.fundingMonthlyVolume || p.volume },
    { enabled: p.factorEnabled, net: p.factorMonthly, vat: p.factorVatPercent, volume: p.factorMonthlyVolume || p.volume },
    { enabled: p.accountEnabled, net: p.accountMonthly, vat: p.accountVatPercent, volume: p.accountMonthlyVolume || p.volume },
  ].filter((fee) => fee.enabled);
  const monthlyBankFeesNet = subscriptions.reduce((sum, fee) => sum + fee.net, 0);
  const monthlyBankFeesGross = subscriptions.reduce((sum, fee) => sum + grossFee(fee.net, fee.vat), 0);
  const subscriptionNetPerWagon = subscriptions.reduce((sum, fee) => sum + fee.net / fee.volume, 0);
  const subscriptionGrossPerWagon = subscriptions.reduce((sum, fee) => sum + grossFee(fee.net, fee.vat) / fee.volume, 0);

  // Same-day incoming and outgoing cash is netted. The order within a day is not modelled.
  const events = new Map();
  function add(day, cash, label) {
    const event = events.get(day) || { day, cash: 0, labels: [] };
    event.cash += cash;
    event.labels.push(label);
    events.set(day, event);
  }
  add(0, 0, 'Начало сделки');
  if (clientAdvance) add(0, clientAdvance, 'Аванс клиента');
  if (insuranceFee) add(0, -insuranceFee, 'Страховая премия');
  if (fundingSetupGross) add(0, -fundingSetupGross, 'Разовая комиссия кредита');
  if (guaranteeFeeGross) add(0, -guaranteeFeeGross, 'Комиссия гарантии');
  if (lcFeeGross) add(0, -lcFeeGross, 'Комиссия аккредитива');
  if (guaranteeCollateral) {
    add(0, -guaranteeCollateral, 'Блокировка залога гарантии');
    add(paymentDay, guaranteeCollateral, 'Возврат залога гарантии');
  }
  if (lcCollateral) {
    add(0, -lcCollateral, 'Блокировка покрытия аккредитива');
    // The covered part pays the supplier from previously blocked cash.
    add(p.supplierDay, lcApplied, 'Использование покрытия аккредитива');
    if (lcUnusedCoverage) {
      add(Math.max(paymentDay, p.supplierDay), lcUnusedCoverage, 'Возврат неиспользованного покрытия аккредитива');
    }
  }
  add(p.supplierDay, -p.purchase, 'Оплата поставщику');
  if (factorUsed) {
    add(factorDay, factorAdvance - (p.factorUpfront ? factorFeeGross : 0),
      p.factorUpfront ? 'Выплата фактора за вычетом комиссии' : 'Выплата фактора');
    add(paymentDay, unpaidInvoice - factorAdvance - (p.factorUpfront ? 0 : factorFeeGross),
      p.factorUpfront ? 'Остаток счёта и резерв фактора' : 'Остаток счёта, резерв и комиссия фактора');
  } else {
    add(paymentDay, unpaidInvoice, 'Оплата клиента');
  }

  let cumulative = p.ownCash;
  let financingRublesDays = 0;
  let priorDay = 0;
  let priorLoanNeed = 0;
  let peakFundingNeed = 0;
  const timeline = [...events.values()].sort((a, b) => a.day - b.day).map((event) => {
    financingRublesDays += priorLoanNeed * (event.day - priorDay);
    cumulative = cleanZero(cumulative + event.cash);
    const loanNeed = cleanZero(Math.max(-cumulative, 0));
    peakFundingNeed = Math.max(peakFundingNeed, loanNeed);
    priorDay = event.day;
    priorLoanNeed = loanNeed;
    return { day: event.day, label: event.labels.join('; '), cash: event.cash, cumulative, loanNeed };
  });
  const creditPricing = priceCredit(p, timeline, paymentDay);
  const creditInterest = creditPricing.creditInterest;
  const initialFundingNeed = timeline[0].loanNeed;
  const confirmedLoanLimit = p.fundingKind === 'none' ? 0 : p.fundingLimit;
  const peakBankLoan = p.fundingKind === 'none' ? 0 : Math.max(peakFundingNeed, creditPricing.amount);
  const uncoveredGap = cleanZero(Math.max((p.fundingKind === 'none' ? peakFundingNeed : peakBankLoan) - confirmedLoanLimit, 0));
  const closingCashAfterInterest = cleanZero(cumulative - creditInterest);
  const closingDebt = cleanZero(Math.max(-closingCashAfterInterest, 0));
  const overheadPerWagon = p.monthlyOverhead / p.volume;
  const markupNet = p.markup / (1 + p.vatPercent / 100);
  const breakdown = {
    interest: creditInterest,
    factor: factorFeeNet,
    insurance: insuranceFee,
    guarantee: guaranteeFeeNet,
    lc: lcFeeNet,
    fundingSetup: fundingSetupNet,
    subscriptions: subscriptionNetPerWagon,
    overhead: overheadPerWagon,
  };
  const profit = markupNet - Object.values(breakdown).reduce((sum, cost) => sum + cost, 0);
  const cashFeeVAT = factorFeeGross - factorFeeNet
    + guaranteeFeeGross - guaranteeFeeNet + lcFeeGross - lcFeeNet
    + fundingSetupGross - fundingSetupNet + subscriptionGrossPerWagon - subscriptionNetPerWagon;
  const warnings = [];
  const scheduleUnconfirmed = p.fundingKind !== 'none' && p.fundingCloseMode === 'scheduled'
    && !p.fundingScheduleConfirmed && creditPricing.amount > 0;
  if (scheduleUnconfirmed) warnings.push({
    code: 'SCHEDULE_UNCONFIRMED',
    message: 'График возврата тела кредита не подтверждён. Платежи и потребность в резерве рассчитаны по плановому графику.',
  });
  const earlyRepaymentUnconfirmed = p.fundingKind !== 'none' && p.fundingCloseMode === 'on_client'
    && !p.fundingEarlyConfirmed && creditPricing.amount > 0;
  if (earlyRepaymentUnconfirmed) warnings.push({
    code: 'EARLY_REPAYMENT_UNCONFIRMED',
    message: 'Досрочное погашение и отмена будущих комиссий не подтверждены.',
  });
  if (creditPricing.tradeFundingGap > 0) warnings.push({
    code: 'SCHEDULE_TRADE_GAP',
    message: `После платежей банку для торговых платежей не хватает ${creditPricing.tradeFundingGap.toFixed(2)} ₽. Нужен дополнительный резерв.`,
  });
  const loanMaximumExceeded = p.fundingKind !== 'none' && p.fundingLoanMax > 0 && peakBankLoan > p.fundingLoanMax;
  if (loanMaximumExceeded) warnings.push({
    code: 'LOAN_MAX_EXCEEDED',
    message: `Нужная сумма кредита ${peakBankLoan.toFixed(2)} ₽ превышает максимальную сумму продукта ${p.fundingLoanMax.toFixed(2)} ₽.`,
  });
  if (creditPricing.repaymentReserveGap > 0) warnings.push({
    code: 'REPAYMENT_RESERVE_GAP',
    message: `До оплаты клиента банк требует ${creditPricing.repaymentsBeforeClient.toFixed(2)} ₽, отдельного резерва не хватает ${creditPricing.repaymentReserveGap.toFixed(2)} ₽. Эти платежи не являются все расходом: погашение тела кредита не уменьшает прибыль.`,
  });
  if (uncoveredGap > 0) warnings.push({
    code: 'FUNDING_GAP',
    message: `Непокрытая потребность в деньгах: ${uncoveredGap.toFixed(2)} ₽. Подтверждённый кредитный лимит не включает факторинг.`,
  });
  if (factorUsed && !p.factorConfirmed) warnings.push({
    code: 'FACTOR_UNCONFIRMED', message: 'В расчёте используется факторинг, но его одобрение не подтверждено.',
  });
  if (p.factorEnabled && !factorUsed) warnings.push({
    code: 'FACTOR_UNUSED', message: p.factorUnavailable
      ? 'Фактор не перечислил финансирование. Абонентская плата активного продукта сохранена.'
      : 'Факторинг не используется: нет финансируемого остатка или выплата не раньше денег клиента. Абонентская плата активного продукта сохранена.',
  });
  if (factorUsed && p.factorRecourse) warnings.push({
    code: 'FACTOR_RECOURSE', message: 'Факторинг с регрессом: риск неоплаты клиента остаётся на компании.',
  });
  if (closingDebt > 0) warnings.push({
    code: 'CLOSING_DEBT', message: `После расчёта по сделке и процентов остаётся долг: ${closingDebt.toFixed(2)} ₽.`,
  });
  const hasMixedMonthlyVolumes = subscriptions.some((fee) => fee.net > 0 && fee.volume !== p.volume);
  if (hasMixedMonthlyVolumes) warnings.push({
    code: 'MONTHLY_VOLUME_DIFFERENT', message: 'Абонентские платы распределены на разные числа заявок. Месячный итог не рассчитывается.',
  });
  const result = {
    invoiceGross, markupNet, profit, breakdown, overheadPerWagon,
    vatOnMarkup: p.markup - markupNet, cashFeeVAT,
    monthlyBankFeesGross, monthlyBankFeesNet, subscriptionNetPerWagon, subscriptionGrossPerWagon,
    monthlyExpectedProfit: hasMixedMonthlyVolumes ? null : profit * p.volume,
    monthlyProjectionNote: hasMixedMonthlyVolumes
      ? 'Разные объёмы по инструментам: месячный итог требует структуры потока по схемам.'
      : 'Проекция для однородного потока: все вагоны месяца проходят по выбранной схеме. Расходы месяца и налоговый резерв не включены в календарь денег сделки.',
    peakFundingNeed, initialFundingNeed, peakBankLoan, uncoveredGap, financingRublesDays, creditInterest, creditPricing,
    dueDay, paymentDay, factorDay, factorDays, factorUsed, factorAdvance,
    factorFeeNet, factorFeeGross, clientAdvance, unpaidInvoice,
    guaranteeFeeNet, guaranteeFeeGross, lcFeeNet, lcFeeGross, lcApplied, lcUnusedCoverage,
    fundingSetupNet, fundingSetupGross,
    timeline, closingCashAfterInterest, closingDebt, warnings,
    executionReady: uncoveredGap === 0 && (!factorUsed || p.factorConfirmed) && closingDebt === 0
      && creditPricing.repaymentReserveGap === 0 && creditPricing.tradeFundingGap === 0
      && !loanMaximumExceeded && !earlyRepaymentUnconfirmed && !scheduleUnconfirmed,
  };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new RangeError('Суммы слишком велики для расчёта. Уменьшите входные значения.');
    }
  }
  return result;
}

/** Economic price only: confirmation and limit warnings are retained by calculate. */
export function minimumMarkup(input = {}, target = 0) {
  const p = normalize(input);
  if (typeof target !== 'number' || !Number.isFinite(target)) {
    throw new RangeError('Целевая прибыль должна быть конечным числом.');
  }
  const cap = 1000000;
  const first = calculate({ ...input, markup: 0 });
  if (first.profit >= target) return { markup: 0, price: first.invoiceGross, profit: first.profit };
  const last = calculate({ ...input, markup: cap });
  // Trade balances, instalments and full-period maximum debt introduce slope
  // changes. Keep their candidate crossings, including non-monotone tariffs.
  const points = [0, cap];
  const addCrossing = (firstValue, lastValue, threshold = 0) => {
    const difference = lastValue - firstValue;
    if (difference === 0) return;
    const crossing = (threshold - firstValue) * cap / difference;
    if (crossing > 0 && crossing < cap) points.push(crossing);
  };
  first.timeline.forEach((event, index) => {
    addCrossing(event.cumulative, last.timeline[index].cumulative);
  });
  if (p.fundingKind !== 'none' && (p.fundingPrincipalMonthly > 0 || p.fundingInterestMode === 'monthly_full'
    || p.fundingCloseMode === 'scheduled')) {
    const instalments = p.fundingCloseMode === 'scheduled' ? p.fundingTermMonths
      : Math.ceil(first.timeline.at(-1).day / 30);
    first.timeline.forEach((event, index) => {
      if (p.fundingLoanMin > 0) {
        const retainedFraction = p.fundingMonthlyUpfront && p.fundingInterestMode === 'monthly_full'
          ? 1 - p.fundingMonthlyRate / 100 : 1;
        addCrossing(event.cumulative, last.timeline[index].cumulative, -p.fundingLoanMin * retainedFraction);
      }
      if (p.fundingPrincipalMonthly > 0) {
        for (let number = 1; number <= instalments; number += 1) {
          addCrossing(event.cumulative, last.timeline[index].cumulative, -number * p.fundingPrincipalMonthly);
        }
      }
      for (let other = index + 1; other < first.timeline.length; other += 1) {
        addCrossing(event.cumulative - first.timeline[other].cumulative,
          last.timeline[index].cumulative - last.timeline[other].cumulative);
        if (p.fundingPrincipalMonthly > 0) {
          for (let number = 1; number <= instalments; number += 1) {
            for (const sign of [-1, 1]) {
              addCrossing(event.cumulative - first.timeline[other].cumulative,
                last.timeline[index].cumulative - last.timeline[other].cumulative,
                sign * number * p.fundingPrincipalMonthly);
            }
          }
        }
      }
    });
  }
  points.sort((a, b) => a - b);
  let leftMarkup = 0;
  for (const rightMarkup of [...new Set(points)].slice(1)) {
    let low = Math.ceil(leftMarkup / 10);
    let high = Math.floor(rightMarkup / 10);
    if (high < low) {
      leftMarkup = rightMarkup;
      continue;
    }
    let result = calculate({ ...input, markup: high * 10 });
    if (result.profit < target && high > low) {
      high -= 1;
      result = calculate({ ...input, markup: high * 10 });
    }
    if (result.profit >= target) {
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (calculate({ ...input, markup: middle * 10 }).profit >= target) high = middle;
        else low = middle + 1;
      }
      const markup = high * 10;
      result = calculate({ ...input, markup });
      if (markup <= cap && result.profit >= target) {
        return { markup, price: result.invoiceGross, profit: result.profit };
      }
    }
    leftMarkup = rightMarkup;
  }
  return null;
}

export function compareScenarios(input = {}) {
  normalize(input);
  return [
    { id: 'cash', label: 'Без заёмных средств', fundingKind: 'none', factorEnabled: false, insuranceEnabled: false },
    { id: 'credit', label: 'Кредит', fundingKind: 'credit', factorEnabled: false, insuranceEnabled: false },
    { id: 'credit-insurance', label: 'Кредит + страхование', fundingKind: 'credit', factorEnabled: false, insuranceEnabled: true },
    { id: 'credit-factor', label: 'Кредит + факторинг', fundingKind: 'credit', factorEnabled: true, insuranceEnabled: false },
    { id: 'credit-factor-insurance', label: 'Кредит + факторинг + страхование', fundingKind: 'credit', factorEnabled: true, insuranceEnabled: true },
  ].map(({ id, label, ...scenario }) => ({ id, label, result: calculate({ ...input, ...scenario }) }));
}
