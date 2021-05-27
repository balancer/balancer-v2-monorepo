import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { BigNumber } from 'ethers';

export type PoolConfig = {
  targetPercentage: BigNumber;
  upperCriticalPercentage: BigNumber;
  lowerCriticalPercentage: BigNumber;
  feePercentage: BigNumber;
};

export const calcRebalanceFee = (poolCash: BigNumber, poolManaged: BigNumber, config: PoolConfig): BigNumber => {
  const poolAssets = poolCash.add(poolManaged);
  const percentageInvested = poolManaged.mul(fp(1)).div(poolAssets);

  if (percentageInvested.gt(config.upperCriticalPercentage)) {
    const upperCriticalBalance = poolAssets.mul(config.upperCriticalPercentage).div(fp(1));
    return poolManaged.sub(upperCriticalBalance).mul(config.feePercentage).div(fp(1));
  }

  if (percentageInvested.lt(config.lowerCriticalPercentage)) {
    const lowerCriticalBalance = poolAssets.mul(config.lowerCriticalPercentage).div(fp(1));
    return lowerCriticalBalance.sub(poolManaged).mul(config.feePercentage).div(fp(1));
  }
  return BigNumber.from(0);
};
