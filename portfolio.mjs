import { calculate, DEFAULTS } from './finance.mjs';

export const FLOW_DEFAULTS = Object.freeze({
  flowMonths: 3, flowMonthlyVolume: 3, flowLoanAmount: 100000, flowDispatch: 'uniform',
});

const PERIOD_DAYS = 30;
const EPSILON = 1e-7;
const clean = value => Math.abs(value) < EPSILON ? 0 : value;
const gross = (net, vat) => net * (1 + vat / 100);

function prepare(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RangeError('Параметры потока должны быть объектом.');
  }
  const p = { ...DEFAULTS, ...FLOW_DEFAULTS, ...input };
  if (!Number.isInteger(p.flowMonths) || p.flowMonths < 3 || p.flowMonths > 12) {
    throw new RangeError('Период потока / срок кредита: введите целое число от 3 до 12 месяцев.');
  }
  if (!Number.isInteger(p.flowMonthlyVolume) || p.flowMonthlyVolume < 1 || p.flowMonthlyVolume > p.volume) {
    throw new RangeError('Число вагонов потока должно быть целым от 1 до общего месячного объёма компании.');
  }
  if (typeof p.flowLoanAmount !== 'number' || !Number.isFinite(p.flowLoanAmount) || p.flowLoanAmount < 0) {
    throw new RangeError('Плановая сумма кредита / лимит линии: введите конечное неотрицательное число.');
  }
  if (!['uniform', 'monthly_batch'].includes(p.flowDispatch)) {
    throw new RangeError('График потока должен быть равномерным или одной партией в начале месяца.');
  }
  if (!['none', 'credit', 'line', 'overdraft'].includes(p.fundingKind)) {
    throw new RangeError('Недопустимое значение параметра fundingKind.');
  }
  if (p.guaranteeEnabled || p.lcEnabled) {
    throw new RangeError('Поток с гарантией или аккредитивом пока не поддерживается. Выключите эти инструменты.');
  }
  if (['line', 'overdraft'].includes(p.fundingKind) && p.fundingInterestMode !== 'annual_daily') {
    throw new RangeError('В потоке линия / овердрафт поддерживает только годовую ставку по фактическому остатку.');
  }
  if (p.fundingKind === 'credit') {
    const monthly = p.fundingInterestMode === 'monthly_full' && p.fundingMonthlyBase === 'initial'
      && p.fundingMonthlyUpfront && p.fundingCloseMode === 'scheduled';
    const annual = p.fundingInterestMode === 'annual_daily' && !p.fundingMonthlyUpfront
      && p.fundingCloseMode === 'scheduled';
    if (!monthly && !annual) {
      throw new RangeError('В потоке фиксированный кредит требует планового графика: полная месячная комиссия на первоначальную выдачу авансом либо годовая ставка по остатку.');
    }
    if (p.fundingMinimumMonths > p.flowMonths) {
      throw new RangeError('Минимальное число оплачиваемых месяцев не может превышать срок плана потока.');
    }
  }
  p.fundingTermMonths = p.flowMonths;
  // Validate original numeric/boolean values before order-only overrides.
  // Disabling credit pricing here avoids applying a one-order loan gross-up
  // to the independently specified fixed portfolio issue. The original kind
  // is checked explicitly above because this validation overrides that field.
  calculate({ ...p, fundingKind: 'none' });
  // Reuse VAT and factor/insurance economics while excluding portfolio credit,
  // own working capital and subscriptions from the individual order.
  const order = calculate({ ...p, fundingKind: 'none', ownCash: 0,
    fundingFeePercent: 0, fundingFeeFixed: 0, fundingMonthly: 0,
    factorMonthly: 0, accountEnabled: false });
  if (p.accountEnabled && p.accountMonthlyVolume > 0 && p.accountMonthlyVolume < p.flowMonthlyVolume) {
    throw new RangeError('Число заявок для распределения платы за счёт не может быть меньше объёма выбранного потока.');
  }
  return { p, order };
}

function operatingPlan(p, order) {
  const events = new Map();
  const cohorts = [];
  const add = (day, field, amount, label) => {
    if (!amount) return;
    const event = events.get(day) || { day, purchases: 0, receipts: 0, insurance: 0,
      otherBankFees: 0, overhead: 0, vatAssessed: 0, feeVat: 0,
      principal: 0, interest: 0, labels: new Set() };
    event[field] += amount;
    if (label) event.labels.add(label);
    events.set(day, event);
  };
  for (let month = 0; month < p.flowMonths; month += 1) {
    for (let day = 0; day < PERIOD_DAYS; day += 1) {
      // Counts are exactly those of floor(i * 30 / N) for i = 0..N-1.
      // Grouping identical dates keeps runtime independent of the wagon count.
      const count = p.flowDispatch === 'monthly_batch' ? (day === 0 ? p.flowMonthlyVolume : 0)
        : Math.ceil((day + 1) * p.flowMonthlyVolume / PERIOD_DAYS)
          - Math.ceil(day * p.flowMonthlyVolume / PERIOD_DAYS);
      if (!count) continue;
      const start = month * PERIOD_DAYS + day;
      cohorts.push({ start, count, paymentDay: start + order.paymentDay });
      add(start, 'vatAssessed', order.vatOnMarkup * count, 'Резерв НДС наценки');
      add(start, 'insurance', order.breakdown.insurance * count, 'Страховая премия');
      add(start + p.supplierDay, 'purchases', p.purchase * count, 'Оплата поставщику');
      add(start, 'receipts', order.clientAdvance * count, 'Аванс клиента');
      if (order.factorUsed) {
        add(start + order.factorDay, 'receipts', order.factorAdvance * count, 'Выплата фактора');
        add(start + order.paymentDay, 'receipts', (order.unpaidInvoice - order.factorAdvance) * count,
          'Остаток счёта / резерв фактора');
        const feeDay = start + (p.factorUpfront ? order.factorDay : order.paymentDay);
        add(feeDay, 'otherBankFees', order.factorFeeGross * count, 'Комиссия факторинга');
        add(feeDay, 'feeVat', (order.factorFeeGross - order.factorFeeNet) * count);
      } else {
        add(start + order.paymentDay, 'receipts', order.unpaidInvoice * count, 'Оплата клиента');
      }
    }
  }
  const horizonDay = p.flowMonths * PERIOD_DAYS;
  const tailEndDay = Math.max(horizonDay, ...cohorts.map(cohort => Math.max(
    cohort.paymentDay, cohort.start + p.supplierDay)));
  const tailMonths = Math.max(p.flowMonths, Math.ceil(tailEndDay / PERIOD_DAYS));
  const subscriptions = [
    { enabled: p.fundingKind !== 'none', net: p.fundingMonthly, vat: p.fundingFeeVatPercent,
      months: p.fundingKind === 'credit' ? p.flowMonths : tailMonths, share: 1, source: 'funding' },
    { enabled: p.factorEnabled, net: p.factorMonthly, vat: p.factorVatPercent,
      months: tailMonths, share: 1, source: 'factor' },
    { enabled: p.accountEnabled, net: p.accountMonthly, vat: p.accountVatPercent,
      months: tailMonths, share: p.flowMonthlyVolume / (p.accountMonthlyVolume || p.volume), source: 'account' },
  ].filter(fee => fee.enabled);
  let subscriptionsNet = 0;
  let subscriptionsGross = 0;
  for (const fee of subscriptions) {
    const net = fee.net * fee.share;
    const cash = gross(net, fee.vat);
    subscriptionsNet += net * fee.months;
    subscriptionsGross += cash * fee.months;
    for (let month = 0; month < fee.months; month += 1) {
      add(month * PERIOD_DAYS, 'otherBankFees', cash, 'Абонентская плата');
      add(month * PERIOD_DAYS, 'feeVat', cash - net);
    }
  }
  const monthlyOverhead = p.monthlyOverhead / p.volume * p.flowMonthlyVolume;
  for (let month = 0; month < p.flowMonths; month += 1) {
    add((month + 1) * PERIOD_DAYS, 'overhead', monthlyOverhead, 'Расходы компании, доля потока');
  }
  const setupNet = p.fundingKind === 'none' ? 0
    : p.flowLoanAmount * p.fundingFeePercent / 100 + p.fundingFeeFixed;
  const setupGross = gross(setupNet, p.fundingFeeVatPercent);
  add(0, 'otherBankFees', setupGross, 'Разовая комиссия финансирования');
  add(0, 'feeVat', setupGross - setupNet);
  return { events, cohorts, add, horizonDay, tailEndDay, tailMonths, subscriptions,
    subscriptionsNet, subscriptionsGross, setupNet, setupGross, monthlyOverhead };
}

function addFixedCredit(p, plan) {
  const payments = [];
  const periods = [];
  let debt = p.flowLoanAmount;
  const flat = p.fundingInterestMode === 'monthly_full';
  for (let month = 0; month < p.flowMonths; month += 1) {
    const startDay = month * PERIOD_DAYS;
    const endDay = startDay + PERIOD_DAYS;
    const base = flat ? p.flowLoanAmount : debt;
    const interest = flat ? base * p.fundingMonthlyRate / 100
      : base * p.fundingRate / 100 * PERIOD_DAYS / 365;
    const principal = month === p.flowMonths - 1 ? debt : Math.min(debt,
      p.fundingPrincipalMode === 'equal' ? p.flowLoanAmount / p.flowMonths : p.fundingPrincipalMonthly);
    const interestDay = flat ? startDay : endDay;
    plan.add(interestDay, 'interest', interest, 'Комиссия / проценты кредита');
    plan.add(endDay, 'principal', principal, 'Погашение тела кредита');
    periods.push({ startDay, endDay, base, interest });
    payments.push({ day: interestDay, principal: 0, interest, total: interest },
      { day: endDay, principal, interest: 0, total: principal });
    debt = clean(debt - principal);
  }
  return { periods, payments: payments.filter(payment => payment.total > 0) };
}

/**
 * Finite, identical-order portfolio. Month = 30 days; orders start during H
 * months, then all supplier/client/factor events are followed to the tail.
 * VAT is conservatively reserved on the order date, not a statutory tax date.
 * Same-day movements are netted. A fixed loan is issued once, never grossed up
 * or redrawn. The separate existing reserve pays bank debt service first;
 * it is never used for purchases or introduced again for each month.
 * Line drawings cover the cash shortfall within a planned cap, and positive
 * operating cash repays the line. Its interest is settled every 30 days.
 */
export function calculatePortfolio(input = {}) {
  const { p, order } = prepare(input);
  const plan = operatingPlan(p, order);
  const fixed = p.fundingKind === 'credit';
  const revolving = ['line', 'overdraft'].includes(p.fundingKind);
  const funded = fixed || revolving;
  const contracted = fixed ? addFixedCredit(p, plan) : { periods: [], payments: [] };
  const totalWagons = p.flowMonths * p.flowMonthlyVolume;
  const months = Array.from({ length: Math.floor(plan.tailEndDay / PERIOD_DAYS) + 1 }, (_, index) => ({
    month: index + 1, startDay: index * PERIOD_DAYS,
    endDay: Math.min((index + 1) * PERIOD_DAYS - 1, plan.tailEndDay),
    purchases: 0, receipts: 0, principal: 0, interest: 0, otherBankFees: 0,
    insurance: 0, overhead: 0, vatReserve: 0, drawn: 0, reserveUsed: 0,
    cashStart: 0, cashEnd: 0,
    minCash: Infinity, debtEnd: 0, reserveEnd: 0, externalGap: 0,
  }));
  let cash = p.ownCash;
  let reserve = p.fundingRepaymentReserve;
  let debt = fixed ? p.flowLoanAmount : 0;
  let maxDebt = debt;
  let minCash = cash;
  let creditInterest = 0;
  let principalRepaid = 0;
  let financingRublesDays = 0;
  let periodRublesDays = 0;
  let periodStart = 0;
  let vatAssessed = 0;
  let feeVat = 0;
  let vatReserved = 0;
  let cashAtHorizon = cash;
  let debtAtHorizon = debt;
  let initialFundingNeed = 0;
  let totalDrawn = fixed ? p.flowLoanAmount : 0;
  const timeline = [];
  const periods = [...contracted.periods];
  const paymentByDay = new Map();
  for (const payment of contracted.payments) {
    const row = paymentByDay.get(payment.day) || { day: payment.day, principal: 0, interest: 0, total: 0 };
    row.principal += payment.principal;
    row.interest += payment.interest;
    row.total = row.principal + row.interest;
    paymentByDay.set(payment.day, row);
  }
  for (let day = 0; day <= plan.tailEndDay; day += 1) {
    if (day > 0 && funded) {
      financingRublesDays += debt;
      if (revolving) periodRublesDays += debt;
    }
    const event = plan.events.get(day);
    let interest = event?.interest || 0;
    let principal = event?.principal || 0;
    if (revolving && day > 0 && (day % PERIOD_DAYS === 0 || day === plan.tailEndDay)) {
      interest += periodRublesDays * p.fundingRate / 100 / 365;
      periods.push({ startDay: periodStart, endDay: day, base: null,
        rublesDays: periodRublesDays, interest });
      periodRublesDays = 0;
      periodStart = day;
    }
    vatAssessed += event?.vatAssessed || 0;
    feeVat += event?.feeVat || 0;
    const nextVatReserve = Math.max(vatAssessed - feeVat, 0);
    const vatReserve = nextVatReserve - vatReserved;
    vatReserved = nextVatReserve;
    const operatingCash = (event?.receipts || 0) - (event?.purchases || 0)
      - (event?.insurance || 0) - (event?.otherBankFees || 0)
      - (event?.overhead || 0) - vatReserve;
    const openingCash = cash;
    let drawn = fixed && day === 0 ? p.flowLoanAmount : 0;
    cash += drawn + operatingCash;
    if (day === 0) initialFundingNeed = Math.max(-p.ownCash - operatingCash + interest, 0);
    if (revolving && day === plan.tailEndDay) principal = debt;
    const debtService = principal + interest;
    const reserveUsed = Math.min(reserve, debtService);
    reserve = clean(reserve - reserveUsed);
    cash += reserveUsed - debtService;
    debt = clean(debt - principal);
    principalRepaid += principal;
    creditInterest += interest;
    if (revolving && day < plan.tailEndDay) {
      if (cash < 0) {
        drawn = Math.min(-cash, Math.max(p.flowLoanAmount - debt, 0));
        cash += drawn;
        debt += drawn;
        totalDrawn += drawn;
      } else if (cash > 0 && debt > 0) {
        const repayment = Math.min(cash, debt);
        cash -= repayment;
        debt -= repayment;
        principal += repayment;
        principalRepaid += repayment;
      }
    }
    cash = clean(cash);
    debt = clean(debt);
    minCash = Math.min(minCash, cash);
    maxDebt = Math.max(maxDebt, debt);
    if (day === plan.horizonDay) {
      cashAtHorizon = cash;
      debtAtHorizon = debt;
    }
    const month = months[Math.floor(day / PERIOD_DAYS)];
    if (day % PERIOD_DAYS === 0) month.cashStart = openingCash;
    for (const field of ['purchases', 'receipts', 'otherBankFees', 'insurance', 'overhead']) {
      month[field] += event?.[field] || 0;
    }
    month.principal += principal;
    month.interest += interest;
    month.vatReserve += vatReserve;
    month.drawn += drawn;
    month.reserveUsed += reserveUsed;
    month.cashEnd = cash;
    month.minCash = Math.min(month.minCash, cash);
    month.debtEnd = debt;
    month.reserveEnd = reserve;
    month.externalGap = Math.max(month.externalGap, -cash, 0);
    if (event || drawn || principal || interest || day === 0 || day === plan.horizonDay || day === plan.tailEndDay) {
      const labels = [...(event?.labels || [])];
      if (drawn) labels.push(fixed ? 'Выдача кредита' : 'Выборка линии');
      if (revolving && principal) labels.push('Возврат линии');
      if (revolving && interest) labels.push('Проценты линии');
      timeline.push({ day, label: labels.join('; '), purchases: event?.purchases || 0,
        receipts: event?.receipts || 0, otherBankFees: event?.otherBankFees || 0,
        overhead: event?.overhead || 0, insurance: event?.insurance || 0,
        principal, interest, vatReserve, drawn, reserveUsed,
        cash: clean(cash - openingCash), cashEnd: cash, cumulative: cash,
        debtEnd: debt, reserveEnd: reserve, loanNeed: Math.max(-cash, 0) });
    }
    if (revolving && (principal || interest)) {
      paymentByDay.set(day, { day, principal, interest, total: principal + interest });
    }
  }
  const breakdownPerWagon = {
    interest: creditInterest / totalWagons, factor: order.factorFeeNet,
    insurance: order.breakdown.insurance, fundingSetup: plan.setupNet / totalWagons,
    subscriptions: plan.subscriptionsNet / totalWagons, overhead: p.monthlyOverhead / p.volume,
  };
  const bankCostPerWagon = breakdownPerWagon.interest + breakdownPerWagon.factor
    + breakdownPerWagon.fundingSetup + breakdownPerWagon.subscriptions;
  const profitPerWagon = order.markupNet - Object.values(breakdownPerWagon).reduce((sum, cost) => sum + cost, 0);
  const uncoveredGap = clean(Math.max(-minCash, 0));
  const pending = plan.cohorts.filter(cohort => cohort.paymentDay > plan.horizonDay);
  const receivables = {
    atHorizon: pending.reduce((sum, cohort) => sum + cohort.count * (order.unpaidInvoice
      - (order.factorUsed && cohort.start + order.factorDay <= plan.horizonDay ? order.factorAdvance : 0)), 0),
    clientOutstandingGross: pending.reduce((sum, cohort) => sum + cohort.count * order.unpaidInvoice, 0),
    ordersOutstanding: pending.reduce((sum, cohort) => sum + cohort.count, 0),
    afterHorizon: 0, tailEndDay: plan.tailEndDay,
  };
  const warnings = [{ code: 'VAT_RESERVE_ESTIMATE', message: 'НДС наценки резервируется с даты заявки с полным входным вычетом. Это консервативный резерв, а не налоговый календарь; излишний вычет не считается возвратом денег.' },
    { code: 'SAME_DAY_NETTING', message: 'Платежи одного дня взаимозачтены. Для исполнения нужен внутридневной запас и проверка реальных дат закупок.' }];
  if (uncoveredGap > 0) warnings.push({ code: 'FLOW_CASH_GAP', message: `По календарю потока требуется ещё ${uncoveredGap.toFixed(2)} ₽ собственных или внешних денег. Цена и прибыль не устраняют дефицит автоматически.` });
  const approvalGap = funded ? Math.max(p.flowLoanAmount - p.fundingLimit, 0) : 0;
  if (approvalGap > 0) warnings.push({ code: 'FLOW_LIMIT_UNCONFIRMED', message: 'Плановая выдача / лимит превышает отдельно введённый подтверждённый лимит.' });
  const minimumViolated = fixed && p.flowLoanAmount > 0 && p.flowLoanAmount < p.fundingLoanMin;
  const maximumViolated = fixed && p.fundingLoanMax > 0 && p.flowLoanAmount > p.fundingLoanMax;
  if (minimumViolated || maximumViolated) warnings.push({ code: 'FLOW_LOAN_BOUNDS', message: 'Фиксированная сумма кредита выходит за ограничения выбранного продукта.' });
  const unconfirmedSchedule = fixed && p.flowLoanAmount > 0 && !p.fundingScheduleConfirmed;
  if (unconfirmedSchedule) warnings.push({ code: 'SCHEDULE_UNCONFIRMED', message: 'График погашения тела — неподтверждённый плановый пример. Комиссия на первоначальную выдачу не уменьшается при поступлении денег клиента.' });
  if (order.factorUsed && !p.factorConfirmed) warnings.push({ code: 'FACTOR_UNCONFIRMED', message: 'В потоке используется факторинг, но его одобрение не подтверждено.' });
  if (order.factorUsed && p.factorRecourse) warnings.push({ code: 'FACTOR_RECOURSE', message: 'Факторинг с регрессом: риск неоплаты клиента остаётся на компании.' });
  if (p.factorEnabled && !order.factorUsed) warnings.push({ code: 'FACTOR_UNUSED', message: 'Выплаты фактора в этом графике нет; абонентская плата активного продукта сохранена.' });
  if (plan.tailMonths > p.flowMonths) warnings.push({ code: 'FLOW_SERVICE_TAIL', message: 'Счёт, факторинг и линия обслуживают также хвост неоплаченных заявок; соответствующие подписки включены до окончания хвоста.' });
  if (revolving) warnings.push({ code: 'FLOW_LINE_ASSUMPTION', message: 'Линия повторно выбирается в пределах планового лимита и сохраняется до окончания хвоста. Срок доступности и разрешение финансировать комиссии нужно подтвердить у банка.' });
  const result = {
    flowMonths: p.flowMonths, flowMonthlyVolume: p.flowMonthlyVolume, totalWagons,
    horizonDay: plan.horizonDay, serviceMonths: plan.tailMonths,
    invoiceGross: order.invoiceGross, markupNet: order.markupNet, profit: profitPerWagon,
    profitPerWagon, totalProfit: profitPerWagon * totalWagons,
    monthlyProfit: profitPerWagon * p.flowMonthlyVolume, monthlyExpectedProfit: profitPerWagon * p.flowMonthlyVolume,
    bankCostPerWagon, breakdownPerWagon, breakdown: breakdownPerWagon,
    overheadPerWagon: breakdownPerWagon.overhead, creditInterest, principalRepaid,
    factorUsed: order.factorUsed, factorDay: order.factorDay, factorDays: order.factorDays,
    factorFeeNet: order.factorFeeNet, factorFeeGross: order.factorFeeGross,
    factorAdvance: order.factorAdvance, paymentDay: order.paymentDay,
    fundingSetupNet: plan.setupNet, fundingSetupGross: plan.setupGross,
    subscriptionsNet: plan.subscriptionsNet, subscriptionsGross: plan.subscriptionsGross,
    cashFeeVAT: order.factorFeeGross - order.factorFeeNet
      + (plan.setupGross - plan.setupNet + plan.subscriptionsGross - plan.subscriptionsNet) / totalWagons,
    vatOnMarkup: order.vatOnMarkup, vatReserved, vatCreditBalance: Math.max(feeVat - vatAssessed, 0),
    initialFundingNeed, peakFundingNeed: maxDebt + uncoveredGap, peakBankLoan: maxDebt,
    uncoveredGap, approvalGap, financingRublesDays, closingCash: cash, closingDebt: debt,
    closingCashAfterInterest: cash, timeline, months, receivables,
    cash: { minimum: minCash, end: cash, atHorizon: cashAtHorizon,
      debtAtHorizon, maxDebt, closingDebt: debt, externalGap: uncoveredGap,
      reserveUsed: p.fundingRepaymentReserve - reserve, reserveRemaining: reserve, totalDrawn },
    creditPricing: { amount: funded ? p.flowLoanAmount : 0, loanAmount: fixed ? p.flowLoanAmount : 0,
      firstFee: fixed && p.fundingInterestMode === 'monthly_full' ? p.flowLoanAmount * p.fundingMonthlyRate / 100 : 0,
      netAvailable: fixed ? p.flowLoanAmount - (p.fundingInterestMode === 'monthly_full' ? p.flowLoanAmount * p.fundingMonthlyRate / 100 : 0)
        : revolving ? p.flowLoanAmount : 0,
      periods, repaymentSchedule: [...paymentByDay.values()].sort((a, b) => a.day - b.day),
      creditInterest, principalRepaid, endDay: fixed ? plan.horizonDay : plan.tailEndDay },
    warnings, executionReady: uncoveredGap === 0 && approvalGap === 0
      && !minimumViolated && !maximumViolated && !unconfirmedSchedule
      && (!order.factorUsed || p.factorConfirmed),
  };
  for (const value of Object.values(result)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new RangeError('Суммы слишком велики для расчёта потока.');
    }
  }
  return result;
}

/**
 * Trace one affine price segment of the revolving cash model. Each amount
 * carries its exact right derivative with respect to the gross markup. Every
 * min/max records the next price at which its selected branch can change.
 * Following these segments from low to high finds the first price even when
 * a later draw, exhausted reserve or line cap makes profit non-monotone.
 */
function linePriceSegment(input, markup) {
  const { p, order } = prepare({ ...input, markup });
  const plan = operatingPlan(p, order);
  const clientFraction = 1 - p.advancePercent / 100;
  const factorFraction = p.factorAdvancePercent / 100;
  const factorSlope = order.factorUsed ? clientFraction * (p.factorRate / 100 * order.factorDays / 365
    * (p.factorRateBase === 'advance' ? factorFraction : 1) + p.factorFeePercent / 100) : 0;
  const insuranceSlope = p.insuranceEnabled ? p.insurancePercent / 100 : 0;
  const markupNetSlope = 1 / (1 + p.vatPercent / 100);
  const derivativeOrder = { ...order, invoiceGross: 1, markupNet: markupNetSlope,
    vatOnMarkup: 1 - markupNetSlope, clientAdvance: p.advancePercent / 100,
    unpaidInvoice: clientFraction, factorAdvance: order.factorUsed ? clientFraction * factorFraction : 0,
    factorFeeNet: factorSlope, factorFeeGross: gross(factorSlope, p.factorVatPercent),
    breakdown: { ...order.breakdown, insurance: insuranceSlope } };
  // Dates and cohort counts do not depend on price. Passing their derivatives
  // through the same event builder avoids a second copy of order cash rules.
  const derivativePlan = operatingPlan({ ...p, purchase: 0, monthlyOverhead: 0,
    flowLoanAmount: 0, fundingFeeFixed: 0, fundingMonthly: 0, factorMonthly: 0,
    accountMonthly: 0 }, derivativeOrder);
  const affine = (value, slope = 0) => ({ value, slope });
  const zero = affine(0);
  const add = (a, b) => affine(a.value + b.value, a.slope + b.slope);
  const scale = (a, multiplier) => affine(a.value * multiplier, a.slope * multiplier);
  const subtract = (a, b) => add(a, scale(b, -1));
  let span = Infinity;
  const maximum = (a, b) => {
    const selected = a.value > b.value || (a.value === b.value && a.slope >= b.slope) ? a : b;
    const other = selected === a ? b : a;
    if (selected.slope < other.slope) {
      const crossing = (selected.value - other.value) / (other.slope - selected.slope);
      if (crossing > 0) span = Math.min(span, crossing);
    }
    return selected;
  };
  const minimum = (a, b) => scale(maximum(scale(a, -1), scale(b, -1)), -1);
  const days = new Set([0, plan.tailEndDay, ...plan.events.keys(), ...derivativePlan.events.keys()]);
  for (let day = PERIOD_DAYS; day < plan.tailEndDay; day += PERIOD_DAYS) days.add(day);
  let cash = affine(p.ownCash);
  let reserve = affine(p.fundingRepaymentReserve);
  let debt = zero;
  let periodRublesDays = zero;
  let creditInterest = zero;
  let vatAssessed = zero;
  let feeVat = zero;
  let vatReserved = zero;
  let previousDay = 0;
  for (const day of [...days].sort((a, b) => a - b)) {
    periodRublesDays = add(periodRublesDays, scale(debt, day - previousDay));
    previousDay = day;
    let interest = zero;
    if (day > 0 && (day % PERIOD_DAYS === 0 || day === plan.tailEndDay)) {
      interest = scale(periodRublesDays, p.fundingRate / 100 / 365);
      creditInterest = add(creditInterest, interest);
      periodRublesDays = zero;
    }
    // Final settlement does not affect any further interest or economic cost.
    if (day === plan.tailEndDay) break;
    const event = plan.events.get(day);
    const derivative = derivativePlan.events.get(day);
    const field = key => affine(event?.[key] || 0, derivative?.[key] || 0);
    vatAssessed = add(vatAssessed, field('vatAssessed'));
    feeVat = add(feeVat, field('feeVat'));
    const nextVatReserve = maximum(subtract(vatAssessed, feeVat), zero);
    const vatChange = subtract(nextVatReserve, vatReserved);
    vatReserved = nextVatReserve;
    cash = add(cash, subtract(field('receipts'), add(field('purchases'),
      add(field('insurance'), add(field('otherBankFees'), add(field('overhead'), vatChange))))));
    const reserveUsed = minimum(reserve, interest);
    reserve = subtract(reserve, reserveUsed);
    cash = add(cash, subtract(reserveUsed, interest));
    const drawn = minimum(maximum(scale(cash, -1), zero),
      maximum(subtract(affine(p.flowLoanAmount), debt), zero));
    cash = add(cash, drawn);
    debt = add(debt, drawn);
    const repaid = minimum(maximum(cash, zero), debt);
    cash = subtract(cash, repaid);
    debt = subtract(debt, repaid);
  }
  const totalWagons = p.flowMonths * p.flowMonthlyVolume;
  const beforeInterest = order.markupNet - order.factorFeeNet - order.breakdown.insurance
    - (plan.setupNet + plan.subscriptionsNet) / totalWagons - p.monthlyOverhead / p.volume;
  return { profit: beforeInterest - creditInterest.value / totalWagons,
    slope: markupNetSlope - factorSlope - insuranceSlope - creditInterest.slope / totalWagons,
    span };
}

/**
 * First feasible VAT-inclusive markup on the 10-ruble grid up to 1,000,000.
 * Fixed-loan/no-loan profit is affine; a revolving line is searched segment
 * by segment, not by a global monotonicity assumption. Complexity/precision
 * failures explicitly leave manual calculation available instead of claiming
 * that no economic price exists.
 */
export function minimumPortfolioMarkup(input = {}, target = 0) {
  if (typeof target !== 'number' || !Number.isFinite(target)) {
    throw new RangeError('Целевая прибыль должна быть конечным числом.');
  }
  const at = markup => calculatePortfolio({ ...input, markup });
  const quote = (markup, result) => ({ markup, price: result.invoiceGross,
    profit: result.profitPerWagon, bankCostPerWagon: result.bankCostPerWagon,
    uncoveredGap: result.uncoveredGap, executionReady: result.executionReady, result });
  const first = at(0);
  if (first.profitPerWagon >= target) return quote(0, first);
  const params = { ...DEFAULTS, ...FLOW_DEFAULTS, ...input };
  const revolving = ['line', 'overdraft'].includes(params.fundingKind)
    && params.flowLoanAmount > 0 && params.fundingRate > 0;
  const affineSlope = revolving ? null : (at(10).profitPerWagon - first.profitPerWagon) / 10;
  const capGrid = 100000;
  const unsupported = () => new RangeError('Автоматический подбор цены не поддерживает такую сложность или точность графика. Расчёт потока для вручную введённой наценки остаётся доступен.');
  let grid = 0;
  for (let segment = 0; segment < 2048 && grid <= capGrid; segment += 1) {
    const markup = grid * 10;
    const result = grid === 0 ? first : at(markup);
    if (result.profitPerWagon >= target) return quote(markup, result);
    const trace = revolving ? linePriceSegment(input, markup)
      : { profit: result.profitPerWagon, slope: affineSlope, span: Infinity };
    if (!Number.isFinite(trace.slope) || !(trace.span > 0)
      || Math.abs(trace.profit - result.profitPerWagon) > .00001) throw unsupported();
    const end = Math.min(capGrid * 10, markup + trace.span);
    const endGrid = Math.min(capGrid, Math.floor((end + EPSILON) / 10));
    if (trace.slope > 0) {
      let candidateGrid = Math.max(grid + 1,
        Math.ceil((markup + (target - result.profitPerWagon) / trace.slope) / 10));
      if (candidateGrid <= endGrid) {
        let candidate = at(candidateGrid * 10);
        // Float rounding at an exact target can move the crossing by one grid
        // step. Validate the real model and its preceding grid point.
        if (candidate.profitPerWagon < target && candidateGrid < endGrid) {
          candidateGrid += 1;
          candidate = at(candidateGrid * 10);
        }
        if (candidate.profitPerWagon >= target) {
          while (candidateGrid > grid + 1) {
            const previous = at((candidateGrid - 1) * 10);
            if (previous.profitPerWagon < target) break;
            candidateGrid -= 1;
            candidate = previous;
          }
          return quote(candidateGrid * 10, candidate);
        }
      }
    }
    // There is no feasible grid price in this affine segment. Jump only over
    // that proved interval; later profit may increase again after a branch.
    grid = Math.max(grid + 1, endGrid + 1);
  }
  if (grid > capGrid) return null;
  throw unsupported();
}
