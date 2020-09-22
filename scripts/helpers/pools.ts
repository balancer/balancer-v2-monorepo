import { Contract, Signer } from 'ethers';
import { ethers } from '@nomiclabs/buidler';
import { TokenList } from '../../test/helpers/tokens';

export async function setupPool(
  vault: Contract,
  tokens: TokenList,
  controller: Signer,
  makeup: Array<[string, number]>
): Promise<string> {
  vault = vault.connect(controller);

  const poolId = ethers.utils.id(Math.random().toString());
  await vault.newPool(poolId);

  for (const entry of makeup) {
    const token = tokens[entry[0]];
    const denormalizedWeight = ethers.BigNumber.from((25e18).toString()).mul(entry[1]).div(100); // Map 100% to 25e18
    await token.connect(controller).approve(vault.address, (1e18).toString());
    await vault.bind(poolId, token.address, (1e18).toString(), denormalizedWeight);
  }

  return poolId;
}
