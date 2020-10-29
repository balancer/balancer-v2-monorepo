import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract } from 'ethers';
import { ethers } from 'hardhat';
import { TokenList } from '../../test/helpers/tokens';

export async function setupPool(
  vault: Contract,
  strategy: Contract,
  strategyType: number,
  tokens: TokenList,
  controller: SignerWithAddress,
  makeup: Array<[string, string]>
): Promise<string> {
  vault = vault.connect(controller);

  const poolId = ethers.utils.id(Math.random().toString());
  await vault.newPool(poolId, strategy.address, strategyType);

  for (const entry of makeup) {
    const token = tokens[entry[0]];

    await token.mint(controller.address, entry[1]);
    await token.connect(controller).approve(vault.address, entry[1]);
    await vault.bind(poolId, token.address, entry[1]);
  }

  return poolId;
}
