import { DEFAULTS, calculate, minimumMarkup } from './finance.mjs';
import { recommend } from './recommend.mjs';

const activeProducts = ({ params }) => Number(params.fundingKind !== 'none')
  + Number(params.factorEnabled) + Number(params.insuranceEnabled);

const compareQuote = (left, right) => left.quote.price - right.quote.price
  || activeProducts(left) - activeProducts(right);

function unusedFactorReason(params, result) {
  if (!params.factorEnabled || result.factorUsed) return '';
  let reason;
  if (params.factorUnavailable) {
    reason = 'Фактор не перечисляет деньги. Финансирование факторинга не используется.';
  } else if (result.unpaidInvoice === 0) {
    reason = 'Клиент оплачивает весь счёт авансом. Факторинг не требуется.';
  } else if (result.factorDay >= result.paymentDay) {
    reason = `Клиент платит через ${result.paymentDay} дней, фактор — через ${result.factorDay}. Факторинг не ускоряет деньги.`;
  } else {
    reason = 'Доля выплаты фактора равна нулю. Факторинг не даёт денег для сделки.';
  }
  if (params.factorMonthly > 0) reason += ' Абонентская плата факторинга сохраняется.';
  return reason;
}

/** Compare the entered sale price and the minimum sale price for one profit target. */
export function buildOffers(input = {}, targetProfit = 2000, options = {}) {
  if (typeof targetProfit !== 'number' || !Number.isFinite(targetProfit) || targetProfit < 0) {
    throw new RangeError('Целевая прибыль должна быть конечным числом от нуля.');
  }
  const currentResult = calculate(input);
  const params = { ...DEFAULTS, ...input };
  const { risk = 'reliable', insuranceConfirmed = false, alternativeFunding = null } = options;
  const advice = recommend(params, risk, insuranceConfirmed, alternativeFunding);

  function offer(profile) {
    const quote = minimumMarkup(profile.params, targetProfit);
    const quoteResult = quote ? calculate({ ...profile.params, markup: quote.markup }) : null;
    const result = profile.result;
    const riskSuitable = risk === 'reliable' || profile.params.advancePercent === 100
      || (profile.params.insuranceEnabled && insuranceConfirmed)
      || (quoteResult?.factorUsed && profile.params.factorConfirmed && !profile.params.factorRecourse);
    return {
      id: profile.id,
      label: profile.label,
      params: profile.params,
      currentResult: result,
      quote,
      quoteResult,
      riskSuitable: Boolean(riskSuitable),
      executionReadyQuote: Boolean(quoteResult?.executionReady),
      factorUseful: Boolean(quoteResult?.factorUsed),
      bankCostCurrent: Object.entries(result.breakdown)
        .reduce((total, [name, cost]) => total + (name === 'overhead' ? 0 : cost), 0),
      needBeforeClient: quoteResult?.peakFundingNeed ?? null,
      factorUnusedReason: unusedFactorReason(profile.params, quoteResult || result),
    };
  }

  const fundingLabel = params.fundingKind === 'none' ? 'Свои деньги / аванс / отсрочка'
    : params.fundingKind === 'line' ? 'ВКЛ' : params.fundingKind === 'overdraft' ? 'Овердрафт' : 'Кредит';
  const currentLabel = [fundingLabel, ...(params.factorEnabled ? ['факторинг'] : []),
    ...(params.insuranceEnabled ? ['страхование'] : [])].join(' + ');
  const selected = offer({ id: 'current', label: advice.current?.label || `Ваша схема: ${currentLabel}`,
    params, result: currentResult });
  const offers = advice.profiles.filter(profile => profile.id !== 'current').map(offer);
  const ranked = offers.filter(candidate => candidate.quote && candidate.riskSuitable).sort(compareQuote);
  const bestAvailable = ranked.find(candidate => candidate.executionReadyQuote) || null;
  const bestCalculated = ranked.find(candidate => candidate.quoteResult.creditPricing.repaymentReserveGap === 0
    && candidate.quoteResult.creditPricing.tradeFundingGap === 0
    && (candidate.params.fundingKind !== 'none'
      ? !candidate.params.fundingLoanMax || candidate.quoteResult.peakBankLoan <= candidate.params.fundingLoanMax
      : candidate.quoteResult.uncoveredGap === 0)) || null;

  const suffix = params.insuranceEnabled ? '-insurance' : '';
  const compactOffers = [`credit${suffix}`, `credit-factor${suffix}`,
    `alternative${suffix}`, `alternative-factor${suffix}`]
    .map(id => offers.find(candidate => candidate.id === id)).filter(Boolean);
  const ownMoney = offers.find(candidate => candidate.id === `cash${suffix}`);
  if (ownMoney?.quoteResult?.uncoveredGap === 0) compactOffers.push(ownMoney);
  const winner = bestAvailable || bestCalculated;
  if (winner && !compactOffers.some(candidate => candidate.id === winner.id)) {
    if (compactOffers.length < 5) compactOffers.push(winner);
    else compactOffers[4] = winner;
  }

  return {
    selected, offers, bestAvailable, bestCalculated, compactOffers,
    noProtection: risk !== 'reliable' && !offers.some(candidate => candidate.riskSuitable),
    risk, targetProfit,
  };
}
