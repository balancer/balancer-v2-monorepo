import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { Dictionary, fromPairs } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from './contract';

export type TokenList = Dictionary<Contract>;

export async function deploySortedTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  return fromPairs(
    (await Promise.all(symbols.map((_, i) => deployToken(`T${i}`, decimals[i], deployer))))
      .sort((tokenA, tokenB) => (tokenA.address.toLowerCase() > tokenB.address.toLowerCase() ? 1 : -1))
      .map((token, index) => [symbols[index], token])
  );
}

export async function deployToken(symbol: string, decimals?: number, from?: SignerWithAddress): Promise<Contract> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  return deploy('v2-standalone-utils/TestToken', {
    from: deployer,
    args: [deployer.address, symbol, symbol, decimals],
  });
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | BigNumber | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}
