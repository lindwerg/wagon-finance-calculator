/** Personal offer described by the user; repayment details remain unconfirmed. */
export const TOCHKA_PROFILE = Object.freeze({
  fundingInterestMode: 'monthly_full', fundingMonthlyRate: 2.49,
  fundingMonthlyBase: 'initial', fundingMinimumMonths: 1,
  fundingCloseMode: 'scheduled', fundingTermMonths: 3,
  fundingMonthlyUpfront: true, fundingPrincipalMode: 'equal',
  fundingLoanMin: 50000, fundingLoanMax: 27510000,
  fundingEarlyConfirmed: false, fundingScheduleConfirmed: false,
  fundingPrincipalMonthly: 0, fundingRepaymentReserve: 0,
});

export const LINE_PROFILE = Object.freeze({
  fundingKind: 'line', primaryFundingKind: 'line', fundingTermsKnown: true,
  fundingRate: 23.5, fundingLimit: 0,
  fundingInterestMode: 'annual_daily', fundingMonthlyRate: 2,
  fundingMonthlyBase: 'balance', fundingMinimumMonths: 1,
  fundingCloseMode: 'on_client', fundingTermMonths: 3,
  fundingMonthlyUpfront: false, fundingPrincipalMode: 'fixed',
  fundingLoanMin: 0, fundingLoanMax: 0,
  fundingEarlyConfirmed: true, fundingScheduleConfirmed: true,
  fundingPrincipalMonthly: 0, fundingRepaymentReserve: 0,
  fundingFeePercent: 0, fundingFeeFixed: 0, fundingFeeVatPercent: 0,
  fundingMonthly: 0, fundingMonthlyVolume: 0,
});

export function tochkaAlternative(profile = TOCHKA_PROFILE) {
  return {
    ...Object.fromEntries(BILLING_PAIRS.map(([primary, alternative]) => [alternative, profile[primary] ?? TOCHKA_PROFILE[primary]])),
    altKnown: true, altRate: profile.fundingRate ?? 23.5,
    altLimit: profile.fundingLimit ?? 0,
    altFeePercent: profile.fundingFeePercent ?? 0, altFeeFixed: profile.fundingFeeFixed ?? 0,
    altFeeVatPercent: profile.fundingFeeVatPercent ?? 0,
    altMonthly: profile.fundingMonthly ?? 0, altMonthlyVolume: profile.fundingMonthlyVolume ?? 0,
  };
}

export const BILLING_PAIRS = Object.freeze([
  ['fundingInterestMode', 'altInterestMode'], ['fundingMonthlyRate', 'altMonthlyRate'],
  ['fundingMonthlyBase', 'altMonthlyBase'], ['fundingMinimumMonths', 'altMinimumMonths'],
  ['fundingCloseMode', 'altCloseMode'], ['fundingTermMonths', 'altTermMonths'],
  ['fundingMonthlyUpfront', 'altMonthlyUpfront'], ['fundingPrincipalMode', 'altPrincipalMode'],
  ['fundingLoanMin', 'altLoanMin'], ['fundingLoanMax', 'altLoanMax'],
  ['fundingEarlyConfirmed', 'altEarlyConfirmed'], ['fundingScheduleConfirmed', 'altScheduleConfirmed'],
  ['fundingPrincipalMonthly', 'altPrincipalMonthly'], ['fundingRepaymentReserve', 'altRepaymentReserve'],
]);

export const BILLING_ENUMS = Object.freeze({
  fundingInterestMode: ['annual_daily', 'monthly_daily', 'monthly_full'],
  fundingMonthlyBase: ['balance', 'initial'],
  fundingCloseMode: ['on_client', 'scheduled'],
  fundingPrincipalMode: ['fixed', 'equal'],
});
