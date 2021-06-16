import { BigNumber } from 'ethers';
import { fp } from '../../../../pvt/helpers/src/numbers';

export type PoolConfig = {
  targetPercentage: BigNumber;
  upperCriticalPercentage: BigNumber;
  lowerCriticalPercentage: BigNumber;
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
