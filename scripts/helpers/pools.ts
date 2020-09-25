import { Contract, Signer } from 'ethers';
import { ethers } from '@nomiclabs/buidler';
import { TokenList } from '../../test/helpers/tokens';

export async function setupPool(
  vault: Contract,
  curve: Contract,
  tokens: TokenList,
  controller: Signer,
  makeup: Array<[string, number]>
): Promise<string> {
  vault = vault.connect(controller);

  const poolId = ethers.utils.id(Math.random().toString());
  await vault.newPool(poolId, curve.address);

  for (const entry of makeup) {
    const token = tokens[entry[0]];
    await token.connect(controller).approve(vault.address, (1e18).toString());
    await vault.bind(poolId, token.address, (1e18).toString());
  }

  return poolId;
}
