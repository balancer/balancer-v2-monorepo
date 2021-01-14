import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber, Contract } from 'ethers';
import { fromPairs, Dictionary } from 'lodash';
import { deploy } from '../../scripts/helpers/deploy';

export type TokenList = Dictionary<Contract>;

// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress,
  admin?: SignerWithAddress
): Promise<TokenList> {
  const adminAddress = admin?.address || (await ethers.getSigners())[0].address;
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
    const token = await deployToken(symbols[i], decimals[i], from);
    //if (addr !== address) console.log(`TOKEN DEPLOY ERROR`);
    //}
    // Get token contract
    const tokenContract = await Token.attach(token.address);
    tokenSymbols[symbols[i]] = tokenContract;
  }
  return tokenSymbols;

  //return fromPairs(
    //await Promise.all(
      //symbols.map(async (symbol, index) => [
        //symbol,
        //await deploy('TestToken', { from, args: [adminAddress, symbol, symbol, decimals[index]] }),
      //])
    //)
  //);
}

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

export async function deployToken(symbol: string, decimals?: number, from?: SignerWithAddress): Promise<Contract> {
  const [admin, defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  const testToken = await deploy('TestToken', { from: deployer, args: [admin.address, symbol, symbol, decimals] });
  //return testToken.address;
  return testToken;
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | BigNumber | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}
