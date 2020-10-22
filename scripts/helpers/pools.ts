import { Contract, Signer } from 'ethers';
import { ethers } from '@nomiclabs/buidler';
import { TokenList } from '../../test/helpers/tokens';

export async function setupPool(
  vault: Contract,
  strategy: Contract,
  strategyType: number,
  tokens: TokenList,
  controller: Signer,
  makeup: Array<[string, number]>
): Promise<string> {
  vault = vault.connect(controller);

  const poolId = ethers.utils.id(Math.random().toString());
  await vault.newPool(poolId, strategy.address, strategyType);

  for (const entry of makeup) {
    const token = tokens[entry[0]];

    await token.mint(await controller.getAddress(), (100e18).toString());
    await token.connect(controller).approve(vault.address, (100e18).toString());
    await vault.bind(poolId, token.address, (100e18).toString());
  }

  return poolId;
}
