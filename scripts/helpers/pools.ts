import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import { TokenList } from '../../test/helpers/tokens';

export const PairTS = 0;
export const TupleTS = 1;

export type TradingStrategyType = typeof PairTS | typeof TupleTS;

export async function setupPool(
  vault: Contract,
  strategy: Contract,
  strategyType: number,
  tokens: TokenList,
  controller: SignerWithAddress,
  makeup: Array<[string, number]>
): Promise<string> {
  vault = vault.connect(controller);

  const poolId = ethers.utils.id(Math.random().toString());
  await vault.newPool(poolId, strategy.address, strategyType);

  for (const entry of makeup) {
    const token = tokens[entry[0]];

    await token.mint(controller.address, (100e18).toString());
    await token.connect(controller).approve(vault.address, (100e18).toString());
    await vault.bind(poolId, token.address, (100e18).toString());
  }

  return poolId;
}
