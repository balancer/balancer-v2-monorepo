import { ethers } from 'hardhat';
import { Dictionary, fromPairs } from 'lodash';
import { BigNumber, Contract, ContractFactory, Signer } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/src/signer-with-address';

import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

const factories: Dictionary<ContractFactory> = {};

export type TokenList = Dictionary<Contract>;

export type ContractDeploymentParams = {
  from?: Signer;
  args?: Array<unknown>;
};

async function deploy(contract: string, { from, args }: ContractDeploymentParams = {}): Promise<Contract> {
  if (!args) args = [];
  if (!from) from = (await ethers.getSigners())[0];
  const factory = (await getFactory(contract)).connect(from);
  const instance = await factory.deploy(...args);
  return instance.deployed();
}

async function getFactory(contractName: string): Promise<ContractFactory> {
  // Cache factory creation to avoid processing the compiled artifacts multiple times
  let factory = factories[contractName];

  if (factory == undefined) {
    factory = await ethers.getContractFactory(contractName);
    factories[contractName] = factory;
  }

  return factory;
}

// Deploys multiple tokens and returns a symbol -> token dictionary, which can be used in other helpers
export async function deployTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  const tokenSymbols: TokenList = {};
  for (let i = 0; i < symbols.length; i++) {
    if (symbols[i] === 'WETH') {
      tokenSymbols[symbols[i]] = await deploy('WETH9', { from, args: [from ? from.address : ZERO_ADDRESS] });
    } else {
      tokenSymbols[symbols[i]] = await deployToken(symbols[i], decimals[i], from);
    }
  }
  return tokenSymbols;
}

export async function deploySortedTokens(
  symbols: Array<string>,
  decimals: Array<number>,
  from?: SignerWithAddress
): Promise<TokenList> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  return fromPairs(
    (await Promise.all(symbols.map((_, i) => deployToken(`T${i}`, decimals[i], deployer as SignerWithAddress))))
      .sort((tokenA, tokenB) => (tokenA.address.toLowerCase() > tokenB.address.toLowerCase() ? 1 : -1))
      .map((token, index) => [symbols[index], token])
  );
}

export async function deployToken(symbol: string, decimals?: number, from?: SignerWithAddress): Promise<Contract> {
  const [defaultDeployer] = await ethers.getSigners();
  const deployer = from || defaultDeployer;
  return deploy('TestToken', { from: deployer, args: [deployer.address, symbol, symbol, decimals] });
}

export async function mintTokens(
  tokens: TokenList,
  symbol: string,
  recipient: SignerWithAddress | string,
  amount: number | BigNumber | string
): Promise<void> {
  await tokens[symbol].mint(typeof recipient == 'string' ? recipient : recipient.address, amount.toString());
}
