import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { Dictionary } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';

export type TokenList = Dictionary<Contract>;

// Deploys a vanilla ERC20 token that can be minted by any account
export async function deployTokenFromFactory(admin: string, symbol: string, decimals?: number): Promise<string> {
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

export async function deployToken(symbol: string, decimals?: number, from?: SignerWithAddress): Promise<string> {
  const [_, defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  const testToken = await deploy('TestToken', { from: deployer, args: [deployer.address, symbol, symbol, decimals] });
  return testToken.address;
}

// Deploys multiple tokens and returns a symbol -> token dictionary
export async function deployTokensFromFactory(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
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
    //const address = await tokenFactory.callStatic.create(from.address, symbols[i], symbols[i], decimals[i]);
    //if (!deployedTokens.includes(address)) {
    const addr = await deployToken(symbols[i], decimals[i], from);
    //if (addr !== address) console.log(`TOKEN DEPLOY ERROR`);
    //}
    // Get token contract
    const tokenContract = await Token.attach(addr);
    tokenSymbols[symbols[i]] = tokenContract;
  }
  return tokenSymbols;
}

// Deploys multiple tokens and returns a symbol -> token dictionary
export async function deployTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  const tokenSymbols: TokenList = {};
  const Token = await ethers.getContractFactory('TestToken');

  // For each token deploy if not already deployed
  for (let i = 0; i < symbols.length; i++) {
    if (symbols[i] === 'WETH') {
      const weth = await deploy('WETH9', { from, args: [from] });
      tokenSymbols[symbols[i]] = weth;
      continue;
    }
    const addr = await deployToken(symbols[i], decimals[i], from);

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
