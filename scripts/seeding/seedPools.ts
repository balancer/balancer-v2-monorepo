import { ethers } from 'hardhat';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { SignerWithAddress } from 'hardhat-deploy-ethers/dist/src/signer-with-address';
import { BigNumber } from 'ethers';
import { Dictionary } from 'lodash';
import { Contract } from 'ethers';

import * as allPools from './allPools.json';

let deployer: SignerWithAddress;
let controller: SignerWithAddress;

interface Pool {
  id: string;
  finalized: boolean;
  publicSwap: boolean;
  liquidity: number;
  swapFee: BigNumber;
  totalWeight: BigNumber;
  tokens: Token[];
  tokensList: string[];
}

interface Token {
  address: string;
  symbol: string;
  name: string;
  balance: BigNumber;
  decimals: number;
  denormWeight: BigNumber;
}

type ContractList = Dictionary<Contract>;

// % npx hardhat run scripts/seeding/seedPools.ts --network localhost
async function main() {
  [deployer, controller] = await ethers.getSigners();

  // Get deployed vault
  const vault = await ethers.getContract('Vault');

  // Format pools to BigNumber/scaled format
  const formattedPools: Pool[] = formatPools(allPools);

  // Currently filters pools by top 5 liquidity
  const filteredPools: Pool[] = filterPools(formattedPools, 5);

  // Get token symbols and decimals to deploy test tokens
  const [symbols, decimals, balances] = getTokenInfoForDeploy(filteredPools);

  console.log(`\nDeploying tokens...`);
  // Will deploy tokens if not already deployed
  const tokenContracts: ContractList = await deployTokens(deployer.address, symbols, decimals);

  console.log(`Minting & Approving tokens...`);
  for (let i = 0; i < symbols.length; i++) {
    console.log(`${symbols[i]}: ${tokenContracts[symbols[i]].address}`);
    await tokenContracts[symbols[i]].connect(controller).approve(vault.address, MAX_UINT256);
    await tokenContracts[symbols[i]].connect(deployer).mint(controller.address, balances[i]);
  }

  console.log(`\nDeploying Pools using vault: ${vault.address}`);
  await deployPools(filteredPools, tokenContracts);

  return;
}

async function deployPools(filteredPools: Pool[], tokens: ContractList) {
  for (let i = 0; i < filteredPools.length; i++) {
    const tokensList: Array<string> = [];
    const weights: Array<BigNumber> = [];
    const balances: Array<BigNumber> = [];
    const swapFee: BigNumber = filteredPools[i].swapFee;

    for (let j = 0; j < filteredPools[i].tokens.length; j++) {
      tokensList.push(tokens[filteredPools[i].tokens[j].symbol].address);
      weights.push(filteredPools[i].tokens[j].denormWeight);
      balances.push(filteredPools[i].tokens[j].balance);
    }

    // Deploy strategy, pool and provide liquidity
    await deployStrategyPool(tokensList, weights, balances, swapFee);
  }
}

// Deploy strategy then newPool with that strategy
// Finally Add liquidity to pool
async function deployStrategyPool(
  tokens: Array<string>,
  weights: Array<BigNumber>,
  balances: Array<BigNumber>,
  swapFee: BigNumber
) {
  const vault = await ethers.getContract('Vault');
  const cwpFactory = await ethers.getContract('CWPFactory');

  if (!cwpFactory || !vault) {
    console.log('CWPFactory and/or Vault Contracts Not Deployed.');
    return;
  }

  console.log(`\nNew Pool With ${tokens.length} tokens`);
  console.log(`SwapFee: ${swapFee.toString()}\nTokens:`);
  tokens.forEach((token, i) => console.log(`${token} - ${balances[i].toString()}`));

  // Deploy strategy using existing factory
  const totalStrategies = await cwpFactory.getTotalStrategies();
  const deployedStrategies = await cwpFactory.getStrategies(0, totalStrategies);

  const strategyAddr = await cwpFactory.connect(deployer).callStatic.create(tokens, weights, swapFee);
  if (!deployedStrategies.includes(strategyAddr)) {
    console.log('Deploying new strategy...');
    const tx = await cwpFactory.connect(deployer).create(tokens, weights, swapFee);
    const receipt = await tx.wait();
    const event = receipt.events?.find((e: any) => e.event == 'StrategyCreated');
    if (event == undefined) {
      throw new Error('Could not find StrategyCreated event');
    }

    if (strategyAddr !== event.args.strategy) console.log(`STRATEGY DEPLOY ERROR`);
  }

  console.log(`Strategy deployed at: ${strategyAddr}`);

  const strategyType = 0; // 0 for Pair
  // if(tokens.length > 2)
  //   strategyType = 1;

  // Create new pool with strategy
  let tx = await vault.connect(controller).newPool(strategyAddr, strategyType);
  const receipt = await tx.wait();
  const event = receipt.events?.find((e: any) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  const poolId = event.args.poolId;
  console.log(`New Pool ID: ${event.args.poolId}`);

  // Token approval should already be done for vault
  // Add liquidity using pull method
  tx = await vault.connect(controller).addLiquidity(poolId, controller.address, tokens, balances, balances);
}

// Convert all pools to BigNumber/scaled format
function formatPools(allPools: any): Pool[] {
  const formattedPools: Pool[] = [];
  for (let i = 0; i < allPools.pools.length; i++) {
    if (allPools.pools[i].tokens.length < 2) {
      continue;
    }

    const tokens: Token[] = [];
    const pool: Pool = {
      id: allPools.pools[i].id,
      finalized: allPools.pools[i].finalized,
      publicSwap: allPools.pools[i].publicSwap,
      liquidity: Number(allPools.pools[i].liquidity),
      swapFee: ethers.utils.parseUnits(allPools.pools[i].swapFee, 18),
      totalWeight: ethers.utils.parseUnits(allPools.pools[i].totalWeight, 18),
      tokens: tokens,
      tokensList: allPools.pools[i].tokensList,
    };

    // For each token in pool convert weights/decimals and scale balances
    for (let j = 0; j < allPools.pools[i].tokens.length; j++) {
      const token: Token = {
        balance: ethers.utils.parseUnits(
          allPools.pools[i].tokens[j].balance,
          Number(allPools.pools[i].tokens[j].decimals)
        ),
        decimals: Number(allPools.pools[i].tokens[j].decimals),
        denormWeight: ethers.utils.parseUnits(allPools.pools[i].tokens[j].denormWeight, 18),
        symbol: allPools.pools[i].tokens[j].symbol,
        name: allPools.pools[i].tokens[j].name,
        address: allPools.pools[i].tokens[j].address,
      };

      pool.tokens.push(token);
    }

    formattedPools.push(pool);
  }

  return formattedPools;
}

function filterPools(allPools: Pool[], count: number): Pool[] {
  // Order by liquidity
  allPools.sort((a, b) => b.liquidity - a.liquidity);

  return allPools.slice(0, count);
}

// Find array of token symbols, decimals and total balances for pools of interest
function getTokenInfoForDeploy(pools: Pool[]): [Array<string>, Array<number>, Array<BigNumber>] {
  const symbols: Array<string> = [];
  const decimals: Array<number> = [];
  const balanceArray: Array<BigNumber> = [];
  const balances: any = {};
  const buckets: any = {};

  // for each pool check tokens, if not exists add to list
  for (let i = 0; i < pools.length; i++) {
    for (let j = 0; j < pools[i].tokens.length; j++) {
      if (!buckets[pools[i].tokens[j].address]) buckets[pools[i].tokens[j].address] = pools[i].tokens[j];

      if (!balances[pools[i].tokens[j].address]) balances[pools[i].tokens[j].address] = pools[i].tokens[j].balance;
      else balances[pools[i].tokens[j].address] = balances[pools[i].tokens[j].address].add(pools[i].tokens[j].balance);
    }
  }

  for (const key in buckets) {
    symbols.push(buckets[key].symbol);
    decimals.push(buckets[key].decimals);
    balanceArray.push(balances[key]);
  }

  return [symbols, decimals, balanceArray];
}

// Deploys a vanilla ERC20 token that can be minted by any account
async function deployToken(admin: string, symbol: string, decimals?: number): Promise<string> {
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
async function deployTokens(admin: string, symbols: Array<string>, decimals: Array<number>): Promise<ContractList> {
  const tokenContracts: ContractList = {};

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
      const wethFactory = await ethers.getContract('WETH9');
      tokenContracts[symbols[i]] = wethFactory;
      continue;
    }
    const address = await tokenFactory.callStatic.create(admin, symbols[i], symbols[i], decimals[i]);
    if (!deployedTokens.includes(address)) {
      const addr = await deployToken(admin, symbols[i], decimals[i]);
      if (addr !== address) console.log(`TOKEN DEPLOY ERROR`);
    }
    // Get token contract
    const tokenContract = await Token.attach(address);
    tokenContracts[symbols[i]] = tokenContract;
  }

  return tokenContracts;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
