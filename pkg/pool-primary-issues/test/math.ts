import { Decimal } from 'decimal.js';
import { BigNumber } from 'ethers';

import { decimal, fromFp, toFp, scaleDown, fp } from '@balancer-labs/v2-helpers/src/numbers';

export type Params = {
  fee: BigNumber;
  minPrice: BigNumber;
  maxPrice: BigNumber;
};

export function calcCashOutPerSecurityIn(fpSecurityIn: BigNumber, fpSecurityBalance: BigNumber, fpCashBalance: BigNumber, params: Params): Decimal {
  const securityIn = decimal(fpSecurityIn);
  const securityBalance = decimal(fpSecurityBalance);
  const cashBalance = decimal(fpCashBalance);
  const minPrice = decimal(params.minPrice);
  const maxPrice = decimal(params.maxPrice);

  const postPaidSecurityBalance = securityBalance.add(securityIn.toString());
  
  const tokensOut = cashBalance.sub(securityBalance.mul(cashBalance.div(postPaidSecurityBalance)));
  const postPaidCurrencyBalance = cashBalance.sub(tokensOut);
  const scaleUp = toFp(postPaidCurrencyBalance.div(postPaidSecurityBalance));

  if( fromFp(scaleUp) >= fromFp(minPrice) &&  fromFp(scaleUp) <= fromFp(maxPrice)){
    return fromFp(tokensOut);
  }
  else{
    return decimal(0);
  }

}

export function calcSecurityOutPerCashIn(fpCashIn: BigNumber, fpSecurityBalance: BigNumber, fpCashBalance: BigNumber, params: Params): Decimal {
  const cashIn = decimal(fpCashIn);
  const securityBalance = decimal(fpSecurityBalance);
  const cashBalance = decimal(fpCashBalance);
  const minPrice = decimal(params.minPrice);
  const maxPrice = decimal(params.maxPrice);

  const postPaidCurrencyBalance = cashBalance.add(cashIn.toString());
  const tokensOut = securityBalance.sub(cashBalance.mul(securityBalance.div(postPaidCurrencyBalance)));
  const postPaidSecurityBalance = securityBalance.sub(tokensOut);
  const scaleUp = toFp(postPaidCurrencyBalance.div(postPaidSecurityBalance));

  if( fromFp(scaleUp) >= fromFp(minPrice) &&  fromFp(scaleUp) <= fromFp(maxPrice)){
    return fromFp(tokensOut);
  }
  else{
    return decimal(0);
  }
}

export function calcCashInPerSecurityOut(fpSecurityOut: BigNumber, fpSecurityBalance: BigNumber, fpCashBalance: BigNumber, params: Params): Decimal {
  const securityOut = decimal(fpSecurityOut);
  const securityBalance = decimal(fpSecurityBalance);
  const cashBalance = decimal(fpCashBalance);
  const minPrice = decimal(params.minPrice);
  const maxPrice = decimal(params.maxPrice);

  const postPaidSecurityBalance = securityBalance.sub(securityOut.toString());
  const tokensIn = (securityBalance.mul(cashBalance.div(postPaidSecurityBalance))).sub(cashBalance);
  const postPaidCurrencyBalance = cashBalance.add(tokensIn)
  const scaleUp = toFp(postPaidCurrencyBalance.div(postPaidSecurityBalance));

  if( fromFp(scaleUp) >= fromFp(minPrice) &&  fromFp(scaleUp) <= fromFp(maxPrice)){
    return fromFp(tokensIn);
  }
  else{
    return decimal(0);
  }

}

export function calcSecurityInPerCashOut(fpCashOut: BigNumber, fpSecurityBalance: BigNumber, fpCashBalance: BigNumber, params: Params): Decimal {
  const cashOut = decimal(fpCashOut);
  const securityBalance = decimal(fpSecurityBalance);
  const cashBalance = decimal(fpCashBalance);
  const minPrice = decimal(params.minPrice);
  const maxPrice = decimal(params.maxPrice);

  const postPaidCurrencyBalance = cashBalance.sub(cashOut.toString());
  const tokensIn = (cashBalance.mul(securityBalance.div(postPaidCurrencyBalance))).sub(securityBalance);
  const postPaidSecurityBalance = securityBalance.add(tokensIn);
  const scaleUp = toFp(postPaidCurrencyBalance.div(postPaidSecurityBalance));

  if( fromFp(scaleUp) >= fromFp(minPrice) &&  fromFp(scaleUp) <= fromFp(maxPrice)){
    return fromFp(tokensIn);
  }
  else{
    return decimal(0);
  }


}

