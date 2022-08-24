import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { decimal, fromFp, toFp } from '@balancer-labs/v2-helpers/src/numbers';

export type Params = {
  fee: BigNumber;
  minPrice: BigNumber;
  maxPrice: BigNumber;
};

export function calcBptOutPerSecurityIn(
  fpSecurityIn: BigNumber,
  fpSecurityBalance: BigNumber,
  fpCurrencyBalance: BigNumber,
  fpBptSupply: BigNumber,
  params: Params
): Decimal {
  const securityIn = fromFp(fpSecurityIn);
  const securityBalance = fromFp(fpSecurityBalance);
  const bptSupply = fromFp(fpBptSupply);

  const tokensOut = securityIn.div(
    securityBalance.add(securityIn.toString()).div(bptSupply).toString()
  );

  return toFp(tokensOut);
}

export function calcCashInPerSecurityOut(fpSecurityOut: BigNumber, fpSecurityBalance: BigNumber, fpCashBalance: BigNumber, params: Params): Decimal {
  const securityOut = fromFp(fpSecurityOut);
  const securityBalance = fromFp(fpSecurityBalance);
  const cashBalance = fromFp(fpCashBalance);

  const tokensIn = securityBalance.mul(securityOut.toString())
                .div(cashBalance.sub(securityOut.toString()))
                .toString();

  return toFp(tokensIn);
}

export function calcSecurityInPerCashOut(fpCashOut: BigNumber, fpSecurityBalance: BigNumber, fpCashBalance: BigNumber, params: Params): Decimal {
  const cashOut = fromFp(fpCashOut);
  const securityBalance = fromFp(fpSecurityBalance);
  const cashBalance = fromFp(fpCashBalance);

  const tokensIn = cashBalance.mul(cashOut.toString())
                .div(securityBalance.sub(cashOut.toString()))
                .toString();

  return toFp(tokensIn);
}

