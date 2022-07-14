import { BigNumber, ethers } from 'ethers';
import { BigNumberish, bn, fp } from '../../../../pvt/helpers/src/numbers';

export type InvestmentConfig = {
  targetPercentage: BigNumberish;
  upperCriticalPercentage: BigNumberish;
  lowerCriticalPercentage: BigNumberish;
};

export function encodeInvestmentConfig(config: InvestmentConfig): string {
  return ethers.utils.defaultAbiCoder.encode(
    ['uint64', 'uint64', 'uint64'],
    [bn(config.targetPercentage), bn(config.upperCriticalPercentage), bn(config.lowerCriticalPercentage)]
  );
}

/**
 * @param poolCash - the amount of tokens held by the pool in cash
 * @param poolManaged - the amount of tokens held by the pool in it's asset manager
 * @param config - the investment config of the pool
 * @returns the amount of tokens sent from the vault to the asset manager. Negative values indicate tokens being sent to the vault.
 */
export const calcRebalanceAmount = (
  poolCash: BigNumber,
  poolManaged: BigNumber,
  config: InvestmentConfig
): BigNumber => {
  const poolAssets = poolCash.add(poolManaged);
  const targetInvestmentAmount = poolAssets.mul(config.targetPercentage).div(fp(1));

  const investmentAmount = targetInvestmentAmount.sub(poolManaged);
  return investmentAmount;
};
