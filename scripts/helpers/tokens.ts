//import { ethers } from 'hardhat';
import { Contract, ContractFactory } from 'ethers';
import { Dictionary } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from './deploy';

export type TokenList = Dictionary<Contract>;

export async function deployToken(
  ethers: any,
  symbol: string,
  decimals?: number,
  from?: SignerWithAddress
): Promise<string> {
  const [, defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  const testToken = await deploy('TestToken', { from: deployer, args: [deployer.address, symbol, symbol, decimals] });
  return testToken.address;
}

// Deploys multiple tokens and returns a symbol -> token dictionary
export async function deployTokens(
  ethers: any,
  Token: ContractFactory,
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  const tokenSymbols: TokenList = {};
  // For each token deploy if not already deployed
  for (let i = 0; i < symbols.length; i++) {
    if (symbols[i] === 'WETH') {
      const weth = await deploy('WETH9', { from, args: [from] });
      tokenSymbols[symbols[i]] = weth;
      continue;
    }
    const addr = await deployToken(ethers, symbols[i], decimals[i], from);

    // Get token contract
    const tokenContract = await Token.attach(addr);
    tokenSymbols[symbols[i]] = tokenContract;
  }
  return tokenSymbols;
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | string,
  minter?: SignerWithAddress
): Promise<void> {
  const token = minter ? tokens[symbol].connect(minter) : tokens[symbol];
  await token.mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}
