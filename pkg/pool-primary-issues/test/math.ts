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
  const scaleUp = toFp(tokensOut.div(securityIn));

  if(Number(cashBalance) < Number(tokensOut))
  {
    return decimal(1);
  }
  else if( Number(fromFp(scaleUp)) >= Number(fromFp(minPrice)) &&  Number(fromFp(scaleUp)) <= Number(fromFp(maxPrice))){
    return tokensOut;
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
  let tokensOut;
    if(cashBalance!= decimal(0))
      tokensOut = securityBalance.sub(cashBalance.mul(securityBalance.div(postPaidCurrencyBalance)));
    else
      tokensOut = postPaidCurrencyBalance.div(minPrice);

    if(cashIn.div(tokensOut) < minPrice && cashBalance!=decimal(0))
    {   
        tokensOut = postPaidCurrencyBalance.div(minPrice);
    }

  const scaleUp = toFp(cashIn.div(tokensOut));
  if(Number(securityBalance) < Number(tokensOut))
  {
    return decimal(1);
  }
  else if(fromFp(scaleUp) >= fromFp(minPrice) && fromFp(scaleUp) <= fromFp(maxPrice)){
    return tokensOut;
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
  let tokensIn;
  if(cashBalance!= decimal(0))
  {
    tokensIn = (securityBalance.mul(cashBalance.div(postPaidSecurityBalance))).sub(cashBalance);
  }
  else{
    tokensIn = postPaidSecurityBalance.mul(minPrice);
  }
    
  if(tokensIn.div(securityOut) < minPrice && cashBalance!=decimal(0))
  {   
    tokensIn = postPaidSecurityBalance.mul(minPrice);
  }
  const scaleUp = toFp(tokensIn.div(securityOut));

  if(Number(securityOut) > Number(securityBalance))
  {
    return decimal(1);
  }
  else if(Number(fromFp(scaleUp)) >= Number(fromFp(minPrice)) &&  Number(fromFp(scaleUp)) <= Number(fromFp(maxPrice))){
    return tokensIn;
  }
  else
  {
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

  const scaleUp = toFp(cashOut.div(tokensIn));

  if( Number(cashOut) > Number(cashBalance ))
  {
    return decimal(1);
  }
  else if( Number(fromFp(scaleUp)) >= Number(fromFp(minPrice)) &&  Number(fromFp(scaleUp)) <= Number(fromFp(maxPrice))){
    return tokensIn;
  }
  else {
    return decimal(0);
  }
}

