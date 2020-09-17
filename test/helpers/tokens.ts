import { ethers } from '@nomiclabs/buidler';
import { ContractFactory, Contract } from 'ethers';
import { fromPairs, Dictionary } from 'lodash';

export type TokenList = Dictionary<Contract>;

let TestTokenFactory: ContractFactory | undefined;

async function getTestTokenFactory() {
  // Cache factory to avoid processing the compiled artifact multiple times
  if (TestTokenFactory == undefined) {
    TestTokenFactory = await ethers.getContractFactory('TestToken');
  }

  return TestTokenFactory;
}

// Deploys a vanilla ERC20 token that can be minted by any account
export async function deployToken(symbol: string, decimals?: number): Promise<Contract> {
  const factory = await getTestTokenFactory();
  const token = await (await factory.deploy(symbol, symbol, decimals ?? 18)).deployed();
  return token;
}

// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(symbols: Array<string>): Promise<TokenList> {
  return fromPairs(await Promise.all(symbols.map(async (symbol) => [symbol, await deployToken(symbol)])));
}
