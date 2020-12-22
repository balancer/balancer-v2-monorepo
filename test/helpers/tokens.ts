import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber, Contract } from 'ethers';
import { fromPairs, Dictionary } from 'lodash';
import { deploy } from '../../scripts/helpers/deploy';

export type TokenList = Dictionary<Contract>;

export async function deploySortedTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  return fromPairs(
    (await Promise.all(symbols.map((_, i) => deploy('TestToken', { from, args: [`T${i}`, `T${i}`, decimals[i]] }))))
      .sort((tokenA, tokenB) => (tokenA.address.toLowerCase() > tokenB.address.toLowerCase() ? 1 : -1))
      .map((token, index) => [symbols[index], token])
  );
}

export async function deployToken(symbol: string, decimals?: number, from?: SignerWithAddress): Promise<string> {
  const [_, defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  const testToken = await deploy('TestToken', { from: deployer, args: [deployer.address, symbol, symbol, decimals] });
  return testToken.address;
}

// Deploys multiple tokens and returns a symbol -> token dictionary
export async function deployTokensFromFactory(
  admin: string,
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
    const address = await tokenFactory.callStatic.create(admin, symbols[i], symbols[i], decimals[i]);
    if (!deployedTokens.includes(address)) {
      // TODO reinstate this
      //const addr = await deployToken(admin, symbols[i], decimals[i]);
      //if (addr !== address) console.log(`TOKEN DEPLOY ERROR`);
    }
    const addr = await deployToken(symbols[i], decimals[i], from);

    // Get token contract
    const tokenContract = await Token.attach(addr);
    tokenSymbols[symbols[i]] = tokenContract;
  }
  return tokenSymbols;
}


// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress,
  admin?: SignerWithAddress
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
  //const adminAddress = admin?.address || (await ethers.getSigners())[0].address
  //return fromPairs(
    //await Promise.all(
      //symbols.map(async (symbol, index) => [
        //symbol,
        //await deploy('TestToken', { from, args: [adminAddress, symbol, symbol, decimals[index]] }),
      //])
    //)
  //);
}


export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}
