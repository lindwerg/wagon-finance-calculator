import { calculate, compareScenarios } from './finance.mjs';

/** Compare economics only within the user's recorded funding and risk constraints. */
export function recommend(input, risk = 'reliable', insuranceConfirmed = false, alternativeFunding = null) {
  const primaryKind = input.primaryFundingKind || (input.fundingKind === 'overdraft' ? 'overdraft' : 'credit');
  const riskSuitable = (p, r) => risk === 'reliable' || p.advancePercent === 100
    || (p.insuranceEnabled && insuranceConfirmed)
    || (r.factorUsed && p.factorConfirmed && !p.factorRecourse);
  const currentLabel = [input.fundingKind === 'none' ? 'Свои деньги / аванс / отсрочка' : input.fundingKind === 'overdraft' ? 'Овердрафт' : 'Кредит', ...(input.factorEnabled ? ['факторинг'] : []), ...(input.insuranceEnabled ? ['страхование'] : [])].join(' + ');
  const definitions = [
    { id: 'current', label: `Ваша схема: ${currentLabel}`, params: { ...input } },
    { id: 'cash', label: 'Свои деньги / аванс / отсрочка поставщика', params: { ...input, fundingKind: 'none', factorEnabled: false, insuranceEnabled: false } },
    { id: 'cash-insurance', label: 'Свои деньги / аванс + страхование', params: { ...input, fundingKind: 'none', factorEnabled: false, insuranceEnabled: true } },
    { id: 'cash-factor', label: 'Свои деньги / отсрочка + факторинг', params: { ...input, fundingKind: 'none', factorEnabled: true, insuranceEnabled: false } },
    { id: 'cash-factor-insurance', label: 'Свои деньги + факторинг + страхование', params: { ...input, fundingKind: 'none', factorEnabled: true, insuranceEnabled: true } },
    { id: 'credit', label: primaryKind === 'overdraft' ? 'Овердрафт' : 'Кредит', params: { ...input, fundingKind: primaryKind, factorEnabled: false, insuranceEnabled: false } },
    { id: 'credit-insurance', label: `${primaryKind === 'overdraft' ? 'Овердрафт' : 'Кредит'} + страхование`, params: { ...input, fundingKind: primaryKind, factorEnabled: false, insuranceEnabled: true } },
    { id: 'credit-factor', label: `${primaryKind === 'overdraft' ? 'Овердрафт' : 'Кредит'} + факторинг`, params: { ...input, fundingKind: primaryKind, factorEnabled: true, insuranceEnabled: false } },
    { id: 'credit-factor-insurance', label: `${primaryKind === 'overdraft' ? 'Овердрафт' : 'Кредит'} + факторинг + страхование`, params: { ...input, fundingKind: primaryKind, factorEnabled: true, insuranceEnabled: true } },
  ];
  if (alternativeFunding) {
    const kind = alternativeFunding.fundingKind;
    const label = kind === 'overdraft' ? 'Овердрафт' : 'Кредит';
    for (const [suffix, factorEnabled, insuranceEnabled] of [['', false, false], ['-insurance', false, true], ['-factor', true, false], ['-factor-insurance', true, true]]) {
      definitions.push({ id: `alternative${suffix}`, label: [label, ...(factorEnabled ? ['факторинг'] : []), ...(insuranceEnabled ? ['страхование'] : [])].join(' + '), params: { ...input, ...alternativeFunding, factorEnabled, insuranceEnabled } });
    }
  }
  const profiles = definitions.filter(profile => !(input.fundingTermsKnown === false && (profile.id.startsWith('credit') || (profile.id === 'current' && input.fundingKind !== 'none')))).map(profile => ({ ...profile, result: calculate(profile.params) }));
  const products = profile => Number(profile.params.fundingKind !== 'none')
    + Number(profile.result.factorUsed) + Number(profile.params.insuranceEnabled);
  const ranked = [...profiles].sort((a, b) => b.result.profit - a.result.profit
    || products(a) - products(b));
  const feasible = ranked.filter(p => p.result.executionReady && riskSuitable(p.params, p.result));
  const best = feasible[0] || null;
  // A no-loan profile with a funding gap does not constitute a bank proposal.
  const candidate = best ? null : ranked.find(p => (p.params.fundingKind !== 'none'
    || (p.result.factorUsed && p.result.uncoveredGap === 0)) && riskSuitable(p.params, p.result)) || null;
  return {
    best, candidate, profiles,
    current: profiles.find(p => p.id === 'current') || null,
    noProtection: risk !== 'reliable' && !ranked.some(p => riskSuitable(p.params, p.result)),
    risk,
  };
}

export function schemeTable(input) {
  const rows = compareScenarios(input);
  if ((input.primaryFundingKind || input.fundingKind) === 'overdraft') {
    for (const row of rows) {
      if (row.id !== 'cash') {
        row.label = row.label.replace('Кредит', 'Овердрафт');
        row.result = calculate({ ...input, fundingKind: 'overdraft',
          factorEnabled: row.id.includes('factor'), insuranceEnabled: row.id.includes('insurance') });
      }
    }
  }
  return rows;
}
