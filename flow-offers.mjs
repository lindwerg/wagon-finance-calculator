import { calculatePortfolio, minimumPortfolioMarkup } from './portfolio.mjs';

/** Compare the same operating plan with each source's separate bank terms. */
export function buildFlowOffers(params, targetProfit, { alternativeFunding = null, risk = 'reliable', insuranceConfirmed = false } = {}) {
  const primary = { ...params, fundingKind: params.primaryFundingKind };
  const configurations = [
    { id: 'credit', params: { ...primary, factorEnabled: false } },
    { id: 'credit-factor', params: { ...primary, factorEnabled: true } },
    ...(alternativeFunding ? [
      { id: 'alternative', params: { ...params, ...alternativeFunding, fundingTermsKnown: true, factorEnabled: false } },
      { id: 'alternative-factor', params: { ...params, ...alternativeFunding, fundingTermsKnown: true, factorEnabled: true } },
    ] : []),
    { id: 'cash', params: { ...params, fundingKind: 'none', factorEnabled: false } },
    { id: 'cash-factor', params: { ...params, fundingKind: 'none', factorEnabled: true } },
  ];
  const evaluate = configuration => {
    try {
      const currentResult = calculatePortfolio(configuration.params);
      const quote = minimumPortfolioMarkup(configuration.params, targetProfit);
      const quoteResult = quote?.result || null;
      const riskSuitable = risk === 'reliable' || configuration.params.advancePercent === 100
        || (configuration.params.insuranceEnabled && insuranceConfirmed)
        || (quoteResult?.factorUsed && configuration.params.factorConfirmed && !configuration.params.factorRecourse);
      return { ...configuration, currentResult, quote, quoteResult, riskSuitable: Boolean(riskSuitable),
        contractEligible: configuration.params.fundingKind !== 'credit' || configuration.params.flowLoanAmount === 0
          || (configuration.params.flowLoanAmount >= configuration.params.fundingLoanMin
            && (!configuration.params.fundingLoanMax || configuration.params.flowLoanAmount <= configuration.params.fundingLoanMax)),
        executionReadyQuote: Boolean(quoteResult?.executionReady && (configuration.params.fundingKind === 'none' || configuration.params.fundingTermsKnown)), error: '' };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { ...configuration, currentResult: null, quote: null, quoteResult: null, riskSuitable: false,
        executionReadyQuote: false, error: error.message };
    }
  };
  const selected = evaluate({ id: 'current', params });
  if (selected.error) throw new RangeError(selected.error);
  const offers = configurations.map(evaluate);
  const ranked = offers.filter(offer => offer.quote && offer.riskSuitable && offer.contractEligible)
    .sort((a, b) => a.quote.price - b.quote.price
      || (Number(a.params.fundingKind !== 'none') + Number(a.params.factorEnabled))
        - (Number(b.params.fundingKind !== 'none') + Number(b.params.factorEnabled)));
  const bestAvailable = ranked.find(offer => offer.executionReadyQuote) || null;
  const bestCalculated = ranked.find(offer => offer.quoteResult.cash.externalGap < .01) || null;
  const compactOffers = offers.filter(offer => !offer.id.startsWith('cash'));
  const own = params.fundingKind === 'none' ? offers.find(offer => offer.id === (params.factorEnabled ? 'cash-factor' : 'cash'))
    : ranked.find(offer => offer.params.fundingKind === 'none' && offer.quoteResult.cash.externalGap < .01);
  if (own) compactOffers.push(own);
  return { selected, offers, compactOffers, bestAvailable, bestCalculated,
    noProtection: risk !== 'reliable' && !offers.some(offer => offer.riskSuitable) };
}
