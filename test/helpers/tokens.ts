import { ethers } from 'hardhat';
import { SignerWithAddress } from 'hardhat-deploy-ethers/dist/src/signer-with-address';
import { BigNumber, Contract } from 'ethers';
import { fromPairs, Dictionary } from 'lodash';
import { deploy } from '../../scripts/helpers/deploy';

export type TokenList = Dictionary<Contract>;

// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  return fromPairs(
    await Promise.all(
      symbols.map(async (symbol, index) => [
        symbol,
        await deploy('TestToken', { from, args: [symbol, symbol, decimals[index]] }),
      ])
    )
  );
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

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | string | BigNumber
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}

// Deploys multiple tokens and returns a symbol -> token dictionary
export async function deployTokensNew(admin: string, symbols: Array<string>, decimals: Array<number>): Promise<TokenList> {
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
    // Get token contract
    const tokenContract = await Token.attach(address);
    tokenSymbols[symbols[i]] = tokenContract;
  }
  return tokenSymbols;
}
