import { BigNumber, Contract, Event } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as allPools from './allPools.json';
import { TokenList, deployTokens } from '../../helpers/tokens';
import { MAX_UINT128, MAX_UINT256 } from '../../helpers/constants';
import { encodeValidatorData, FundManagement, SwapIn } from '../../helpers/trading';

let ethers: any;
let deployer: SignerWithAddress;
let controller: SignerWithAddress;
let trader: SignerWithAddress;
let validator: Contract;
let investmentManager: SignerWithAddress; // This would normally be a contract

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

module.exports = async function action(args: any, hre: HardhatRuntimeEnvironment) {
  ethers = hre.ethers;
  [deployer, controller, trader, investmentManager] = await ethers.getSigners();

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
  const tokens = await deployTokens(symbols, decimals, deployer);

  console.log(`Minting & Approving tokens...`);
  for (const symbol in tokens) {
    const token = tokens[symbol];
    const index = symbols.indexOf(symbol);
    const tradingBalance = balances[index];
    console.log(`${symbol}: ${token.address}`);

    await token.connect(controller).approve(vault.address, MAX_UINT256);
    await token.connect(deployer).mint(controller.address, tradingBalance);
    await token.connect(deployer).mint(trader.address, tradingBalance);
    await token.connect(trader).approve(vault.address, MAX_UINT256);
    await token.connect(investmentManager).approve(vault.address, MAX_UINT256);

    // deposit half into user balance
    const depositBalance = tradingBalance.div(BigNumber.from('2'));
    await vault.connect(trader).depositToInternalBalance([token.address], [depositBalance], trader.address);
  }

  console.log(`\nDeploying Pools using vault: ${vault.address}`);
  const pools: Contract[] = (await deployPools(filteredPools, tokens)).filter((x): x is Contract => x !== undefined);

  console.log(`\nSwapping a few tokens...`);
  validator = await ethers.getContract('OneToOneSwapValidator');
  await Promise.all(pools.map((p) => swapInPool(p)));

  console.log('Making a few investments...');
  //investmentManager = await ethers.getContract('MockInvestmentManager');
  // TODO add pool type which supports investment
  //await Promise.all(pools.map((p) => investPool(p)));
  return;
};

async function swapInPool(pool: Contract) {
  const poolId = await pool.getPoolId();

  const vault = await ethers.getContract('Vault');
  const tokenAddresses: string[] = await vault.getPoolTokens(poolId);

  const [overallTokenIn, overallTokenOut] = tokenAddresses;

  const swap: SwapIn = {
    poolId,
    tokenInIndex: 0,
    tokenOutIndex: 1,
    amountIn: 100,
    userData: '0x',
  };
  const swaps: SwapIn[] = [swap];

  const funds: FundManagement = {
    recipient: trader.address,
    fromInternalBalance: false,
    toInternalBalance: false,
  };

  await (
    await vault.connect(trader).batchSwapGivenIn(
      validator.address,
      encodeValidatorData({
        overallTokenIn,
        overallTokenOut,
        minimumAmountOut: 0,
        maximumAmountIn: MAX_UINT128,
        deadline: MAX_UINT256,
      }),
      swaps,
      tokenAddresses,
      funds
    )
  ).wait();
}

async function deployPools(filteredPools: Pool[], tokens: TokenList): Promise<(Contract | undefined)[]> {
  const promises = [];
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

    // Deploy pool and provide liquidity
    promises.push(deployStrategyPool(tokensList, weights, balances, swapFee));
  }
  return await Promise.all(promises);
}

// Deploy strategy then newPool with that strategy
// Finally Add liquidity to pool
async function deployStrategyPool(
  tokens: Array<string>,
  weights: Array<BigNumber>,
  balances: Array<BigNumber>,
  swapFee: BigNumber
): Promise<Contract | undefined> {
  const vault = await ethers.getContract('Vault');
  const wpFactoryContract = await ethers.getContract('WeightedPoolFactory');
  const wpFactory = await ethers.getContractFactory('WeightedPool');

  if (!wpFactoryContract || !vault) {
    console.log('WeightedPoolFactory and/or Vault Contracts Not Deployed.');
    return;
  }

  console.log(`\nNew Pool With ${tokens.length} tokens`);
  console.log(`SwapFee: ${swapFee.toString()}\nTokens:`);
  tokens.forEach((token, i) => console.log(`${token} - ${balances[i].toString()}`));

  const name = tokens.length + ' token pool';
  const sym = 'TESTPOOL';
  const parameters = [name, sym, tokens, weights, swapFee];

  const tx = await wpFactoryContract.connect(controller).create(...parameters);
  const receipt = await tx.wait();
  const event = receipt.events?.find((e: Event) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }
  const poolAddress = event.args.pool;

  console.log(`New Pool Address: ${poolAddress}`);
  return await wpFactory.attach(poolAddress);
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
