const PERIOD_DAYS = 30;
const cleanZero = value => Math.abs(value) < 1e-8 ? 0 : value;

function scheduledCredit(params, rawTimeline, clientPaymentDay, result, firstDay) {
  const loanAmount = result.amount;
  const termMonths = params.fundingTermMonths;
  const endDay = firstDay + termMonths * PERIOD_DAYS;
  let debt = loanAmount;
  const payments = new Map();
  const addPayment = (day, principal, interest) => {
    const payment = payments.get(day) || { day, principal: 0, interest: 0, total: 0 };
    payment.principal += principal;
    payment.interest += interest;
    payment.total = payment.principal + payment.interest;
    payments.set(day, payment);
  };
  const upfront = params.fundingMonthlyUpfront && params.fundingInterestMode === 'monthly_full';
  for (let month = 1; month <= termMonths; month += 1) {
    const day = firstDay + month * PERIOD_DAYS;
    const fullMonthly = params.fundingInterestMode === 'monthly_full';
    const minimumOnly = fullMonthly && debt === 0 && month <= params.fundingMinimumMonths;
    const useInitialBase = fullMonthly && ((params.fundingMonthlyBase === 'initial' && debt > 0) || minimumOnly);
    const base = useInitialBase ? loanAmount : debt;
    let interest = params.fundingInterestMode === 'annual_daily'
      ? debt * params.fundingRate / 100 * PERIOD_DAYS / 365
      : base * params.fundingMonthlyRate / 100;
    if (debt > 0 || minimumOnly) {
      result.periods.push({ startDay: day - PERIOD_DAYS, endDay: day, base, interest, minimumOnly });
    }
    if (fullMonthly && month === termMonths) {
      for (let number = termMonths + 1; number <= params.fundingMinimumMonths; number += 1) {
        const minimumInterest = loanAmount * params.fundingMonthlyRate / 100;
        result.periods.push({ startDay: firstDay + (number - 1) * PERIOD_DAYS,
          endDay: firstDay + number * PERIOD_DAYS, base: loanAmount,
          interest: minimumInterest, minimumOnly: true });
        interest += minimumInterest;
      }
    }
    const principalMonthly = params.fundingPrincipalMode === 'equal' ? loanAmount / termMonths : params.fundingPrincipalMonthly;
    const principal = month === termMonths ? debt : Math.min(principalMonthly, debt);
    const periodInterest = result.periods.find(period => period.startDay === day - PERIOD_DAYS)?.interest || 0;
    addPayment(upfront ? day - PERIOD_DAYS : day, 0, periodInterest);
    if (interest > periodInterest) addPayment(day, 0, interest - periodInterest);
    addPayment(day, principal, 0);
    result.creditInterest += interest;
    result.principalRepaid += principal;
    debt = cleanZero(debt - principal);
  }
  result.repaymentSchedule = [...payments.values()].filter(payment => payment.total > 0)
    .sort((left, right) => left.day - right.day);
  let principalPaid = 0;
  let interestPaid = 0;
  let eventIndex = 0;
  let tradeCumulative = 0;
  const paymentByDay = new Map(result.repaymentSchedule.map(payment => [payment.day, payment]));
  const cashDays = [...new Set([...rawTimeline.map(event => event.day), ...paymentByDay.keys()])]
    .filter(day => day >= firstDay).sort((left, right) => left - right);
  for (const day of cashDays) {
    while (eventIndex < rawTimeline.length && rawTimeline[eventIndex].day <= day) {
      tradeCumulative = rawTimeline[eventIndex].cumulative;
      eventIndex += 1;
    }
    const payment = paymentByDay.get(day);
    const availableCash = loanAmount + tradeCumulative - principalPaid - interestPaid + params.fundingRepaymentReserve;
    if (payment) {
      if (day < clientPaymentDay) {
        result.repaymentsBeforeClient += payment.total;
        result.repaymentReserveGap = Math.max(result.repaymentReserveGap, payment.total - availableCash);
      }
      principalPaid += payment.principal;
      interestPaid += payment.interest;
    }
    if (day < clientPaymentDay && rawTimeline.some(event => event.day === day)) {
      result.tradeFundingGap = Math.max(result.tradeFundingGap,
        principalPaid + interestPaid - loanAmount - tradeCumulative - params.fundingRepaymentReserve);
    }
  }
  result.repaymentReserveGap = cleanZero(Math.max(result.repaymentReserveGap, 0));
  result.tradeFundingGap = cleanZero(Math.max(result.tradeFundingGap, 0));
  result.endDay = endDay;
  return result;
}

/**
 * Generic 30-day credit model; these conventions are not a bank tariff.
 * In on_client mode, trade receipts reduce debt and an instalment comes from
 * a separate reserve. Scheduled mode draws the order's peak need once: trade
 * receipts can pay instalments, but only bank principal payments reduce debt.
 * Interest is never capitalised in either mode.
 */
export function priceCredit(params, rawTimeline, clientPaymentDay) {
  const mode = params.fundingInterestMode;
  const result = {
    mode, closeMode: params.fundingCloseMode, periods: [], creditInterest: 0, principalRepaid: 0,
    repaymentSchedule: [], repaymentsBeforeClient: 0, repaymentReserveGap: 0,
    amount: 0, loanAmount: 0, firstFee: 0, netAvailable: 0, tradeFundingGap: 0,
  };
  if (params.fundingKind === 'none') return result;
  const firstDraw = rawTimeline.find(event => event.loanNeed > 0);
  if (!firstDraw) return result;
  const upfront = params.fundingMonthlyUpfront && mode === 'monthly_full';
  const coefficient = upfront ? params.fundingMonthlyRate / 100 : 0;
  if (coefficient >= 1) throw new RangeError('Первая месячная комиссия должна быть меньше 100% суммы кредита.');
  const rawPeak = Math.max(...rawTimeline.map(event => event.loanNeed));
  result.amount = Math.max(rawPeak / (1 - coefficient), params.fundingLoanMin);
  result.loanAmount = result.amount;
  result.firstFee = upfront ? result.amount * coefficient : 0;
  result.netAvailable = result.amount - result.firstFee;
  if (params.fundingCloseMode === 'scheduled') {
    return scheduledCredit(params, rawTimeline, clientPaymentDay, result, firstDraw.day);
  }
  if (upfront) {
    rawTimeline = rawTimeline.map(event => event.day < firstDraw.day ? event : ({ ...event,
      cumulative: event.cumulative - result.firstFee,
      loanNeed: cleanZero(Math.max(-(event.cumulative - result.firstFee), 0)) }));
  }
  const endDay = rawTimeline.at(-1).day;
  const firstDay = firstDraw.day;
  if (endDay <= firstDay) return result;
  const initialPrincipal = upfront ? result.amount : Math.max(firstDraw.loanNeed, params.fundingLoanMin);
  const fullMonthly = mode === 'monthly_full';
  const monthlyPayments = mode !== 'annual_daily' || params.fundingPrincipalMonthly > 0
    || params.fundingPrincipalMode === 'equal';
  const days = new Set(rawTimeline.filter(event => event.day >= firstDay).map(event => event.day));
  for (let day = firstDay + PERIOD_DAYS; day < endDay; day += PERIOD_DAYS) days.add(day);
  days.add(endDay);
  const events = new Map(rawTimeline.map(event => [event.day, event]));
  let previousDay = firstDay;
  let rawNeed = rawTimeline.find(event => event.day === firstDay).loanNeed;
  let debt = rawNeed;
  let debtRublesDays = 0;
  let periodRublesDays = 0;
  let periodMaximum = upfront ? result.amount : 0;
  let periodStart = firstDay;
  let periodNumber = 0;

  const dailyInterest = rublesDays => mode === 'annual_daily'
    ? rublesDays * params.fundingRate / 100 / 365
    : rublesDays * params.fundingMonthlyRate / 100 / PERIOD_DAYS;

  for (const day of [...days].sort((left, right) => left - right)) {
    const elapsed = day - previousDay;
    debtRublesDays += debt * elapsed;
    periodRublesDays += debt * elapsed;
    if (elapsed > 0) periodMaximum = Math.max(periodMaximum, debt);
    if (events.has(day)) rawNeed = events.get(day).loanNeed;
    debt = cleanZero(Math.max(rawNeed - result.principalRepaid, 0));
    const boundary = day > firstDay && (day - firstDay) % PERIOD_DAYS === 0;
    if (boundary || day === endDay) {
      periodNumber += 1;
      let base = fullMonthly && periodMaximum > 0
        ? params.fundingMonthlyBase === 'initial' ? initialPrincipal : periodMaximum : 0;
      const minimumPeriod = fullMonthly && periodNumber <= params.fundingMinimumMonths;
      if (minimumPeriod && base === 0) base = initialPrincipal;
      let interest = fullMonthly ? base * params.fundingMonthlyRate / 100 : dailyInterest(periodRublesDays);
      const principalMonthly = params.fundingPrincipalMode === 'equal'
        ? result.amount / params.fundingTermMonths : params.fundingPrincipalMonthly;
      const principal = boundary ? Math.min(principalMonthly, debt) : 0;
      result.principalRepaid += principal;
      debt = cleanZero(Math.max(rawNeed - result.principalRepaid, 0));
      if (fullMonthly && day === endDay) {
        for (let number = periodNumber + 1; number <= params.fundingMinimumMonths; number += 1) {
          const minimumInterest = initialPrincipal * params.fundingMonthlyRate / 100;
          result.periods.push({ startDay: firstDay + (number - 1) * PERIOD_DAYS,
            endDay: firstDay + number * PERIOD_DAYS, base: initialPrincipal,
            interest: minimumInterest, minimumOnly: true });
          interest += minimumInterest;
        }
      }
      if (base > 0 || periodRublesDays > 0) {
        result.periods.push({ startDay: periodStart, endDay: day, base: fullMonthly ? base : null,
          interest: fullMonthly ? base * params.fundingMonthlyRate / 100 : dailyInterest(periodRublesDays),
          minimumOnly: minimumPeriod && periodMaximum === 0 });
      }
      result.creditInterest += interest;
      if (monthlyPayments && principal + interest > 0) {
        if (upfront) {
          const periodInterest = base * params.fundingMonthlyRate / 100;
          if (periodInterest > 0) result.repaymentSchedule.push({ day: periodStart, principal: 0,
            interest: periodInterest, total: periodInterest });
          if (principal + interest - periodInterest > 0) result.repaymentSchedule.push({ day, principal,
            interest: interest - periodInterest, total: principal + interest - periodInterest });
        } else {
          result.repaymentSchedule.push({ day, principal, interest, total: principal + interest });
        }
      }
      periodStart = day;
      periodRublesDays = 0;
      periodMaximum = 0;
    }
    previousDay = day;
  }
  if (!fullMonthly) result.creditInterest = dailyInterest(debtRublesDays);
  result.periods.sort((left, right) => left.startDay - right.startDay);
  result.repaymentSchedule.sort((left, right) => left.day - right.day);
  if (!monthlyPayments && result.creditInterest > 0) {
    result.repaymentSchedule.push({ day: endDay, principal: 0,
      interest: result.creditInterest, total: result.creditInterest });
  }
  if (monthlyPayments) {
    result.repaymentsBeforeClient = result.repaymentSchedule
      .filter(payment => payment.day < clientPaymentDay)
      .reduce((total, payment) => total + payment.total, 0);
    result.repaymentReserveGap = cleanZero(Math.max(result.repaymentsBeforeClient - result.firstFee
      - params.fundingRepaymentReserve, 0));
  }
  return result;
}
