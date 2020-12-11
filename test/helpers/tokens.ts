import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { Dictionary } from 'lodash';

export type TokenList = Dictionary<Contract>;

// Deploys a vanilla ERC20 token that can be minted by any account
export async function deployToken(admin: string, symbol: string, decimals?: number): Promise<string> {
  // Get deployed Token Factory
  const tokenFactory = await ethers.getContract('TokenFactory');

  const tx = await tokenFactory.create(admin, symbol, symbol, decimals ?? 18);
  const receipt = await tx.wait();
  const event = receipt.events?.find((e: any) => e.event == 'TokenCreated');
  if (event == undefined) {
    throw new Error('Could not find TokenCreated event');
  }

  return event.args.token;
}

// Deploys multiple tokens and returns a symbol -> token dictionary
export async function deployTokens(admin: string, symbols: Array<string>, decimals: Array<number>): Promise<TokenList> {
  const tokenSymbols: TokenList = {};
  // Get artifact for TestToken
  const Token = await ethers.getContractFactory('TestToken');
  // Get deployed Token Factory
  const tokenFactory = await ethers.getContract('TokenFactory');
  // Find list of tokens already deployed by factory
  const totalTokens = await tokenFactory.getTotalTokens();
  const deployedTokens = await tokenFactory.getTokens(0, totalTokens);
  // For each token deploy if not already deployed
  for (let i = 0; i < symbols.length; i++) {
    if (symbols[i] === 'WETH') {
      const weth = await ethers.getContract('WETH9');
      tokenSymbols[symbols[i]] = weth;
      continue;
    }
    const address = await tokenFactory.callStatic.create(admin, symbols[i], symbols[i], decimals[i]);
    if (!deployedTokens.includes(address)) {
      const addr = await deployToken(admin, symbols[i], decimals[i]);
      if (addr !== address) console.log(`TOKEN DEPLOY ERROR`);
    }
    // Get token contract
    const tokenContract = await Token.attach(address);
    tokenSymbols[symbols[i]] = tokenContract;
  }
  return tokenSymbols;
}
