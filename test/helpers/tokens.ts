import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract } from 'ethers';
import { fromPairs, Dictionary } from 'lodash';
import { deploy } from '../../scripts/helpers/deploy';

export type TokenList = Dictionary<Contract>;

// Deploys a vanilla ERC20 token that can be minted by any account
export async function deployToken(symbol: string, decimals?: number): Promise<Contract> {
  const token = await deploy('TestToken', symbol, symbol, decimals ?? 18);
  return token;
}

// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(symbols: Array<string>): Promise<TokenList> {
  return fromPairs(await Promise.all(symbols.map(async (symbol) => [symbol, await deployToken(symbol)])));
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}
