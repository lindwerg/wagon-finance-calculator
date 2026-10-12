export const ALT_DEFAULTS = Object.freeze({
  altKnown: false, altRate: 0, altLimit: 0, altFeePercent: 0, altFeeFixed: 0,
  altFeeVatPercent: 0, altMonthly: 0, altMonthlyVolume: 0,
  primaryFundingKind: 'credit', fundingTermsKnown: true,
});

const PAIRS = [
  ['fundingRate', 'altRate'], ['fundingLimit', 'altLimit'],
  ['fundingFeePercent', 'altFeePercent'], ['fundingFeeFixed', 'altFeeFixed'],
  ['fundingFeeVatPercent', 'altFeeVatPercent'], ['fundingMonthly', 'altMonthly'],
  ['fundingMonthlyVolume', 'altMonthlyVolume'],
];

/** A bank product owns its entire tariff and approved limit, even when disabled. */
export function selectFundingProfile(input, kind) {
  if (!['none', 'credit', 'overdraft'].includes(kind)) throw new RangeError('Неизвестный банковский продукт.');
  const result = { ...input, fundingKind: kind };
  if (kind === 'none' || kind === input.primaryFundingKind) return result;
  for (const [primary, alternative] of PAIRS) {
    result[primary] = input[alternative];
    result[alternative] = input[primary];
  }
  result.fundingTermsKnown = input.altKnown;
  result.altKnown = input.fundingTermsKnown;
  result.primaryFundingKind = kind;
  return result;
}
