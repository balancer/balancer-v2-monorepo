import { BigNumber } from 'ethers';
import { fp } from '../../../../pvt/helpers/src/numbers';

export type PoolConfig = {
  targetPercentage: BigNumber;
  upperCriticalPercentage: BigNumber;
  lowerCriticalPercentage: BigNumber;
  feePercentage: BigNumber;
};

/**
 * @param poolCash - the amount of tokens held by the pool in cash
 * @param poolManaged - the amount of tokens held by the pool in it's asset manager
 * @param config - the investment config of the pool
 * @returns the amount of tokens sent from the vault to the asset manager. Negative values indicate tokens being sent to the vault.
 */
export const calcRebalanceAmount = (poolCash: BigNumber, poolManaged: BigNumber, config: PoolConfig): BigNumber => {
  const poolAssets = poolCash.add(poolManaged);
  const targetInvestmentAmount = poolAssets.mul(config.targetPercentage).div(fp(1));

  const investmentAmount = targetInvestmentAmount.sub(poolManaged);
  return investmentAmount;
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
