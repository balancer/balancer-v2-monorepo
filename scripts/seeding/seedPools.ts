import { MAX_UINT256, MAX_UINT128 } from '../../test/helpers/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { encodeValidatorData, SwapIn, FundManagement } from '../helpers/trading';
import { BigNumber } from 'ethers';
import { Dictionary } from 'lodash';
import { Contract, Event } from 'ethers';

import * as allPools from './allPools.json';
import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

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

type ContractList = Dictionary<Contract>;

task('seed', 'Add seed data').setAction(async (args, hre) => action(hre));

let ethers: any;

// % npx hardhat run scripts/seeding/seedPools.ts --network localhost
async function action(hre: HardhatRuntimeEnvironment) {
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
  const tokenContracts: ContractList = await deployTokens(deployer, symbols, decimals);

  console.log(`Minting & Approving tokens...`);
  for (let i = 0; i < symbols.length; i++) {
    console.log(`${symbols[i]}: ${tokenContracts[symbols[i]].address}`);
    await tokenContracts[symbols[i]].connect(controller).approve(vault.address, MAX_UINT256);
    await tokenContracts[symbols[i]].connect(deployer).mint(controller.address, balances[i]);
    //const tradingBalance = balances[i].div(BigNumber.from('10'))
    const tradingBalance = balances[i]; //.div(BigNumber.from('10'))
    await tokenContracts[symbols[i]].connect(deployer).mint(trader.address, tradingBalance);
    await tokenContracts[symbols[i]].connect(trader).approve(vault.address, MAX_UINT256);
    await tokenContracts[symbols[i]].connect(investmentManager).approve(vault.address, MAX_UINT256);

    // deposit half into user balance
    const depositBalance = tradingBalance.div(BigNumber.from('2'));
    await vault
      .connect(trader)
      .depositToInternalBalance(tokenContracts[symbols[i]].address, depositBalance, trader.address);
  }

  console.log(`\nDeploying Pools using vault: ${vault.address}`);
  const pools: Contract[] = (await deployPools(filteredPools, tokenContracts)).filter(
    (x): x is Contract => x !== undefined
  );

  console.log(`\nSwapping a few tokens...`);
  validator = await ethers.getContract('OneToOneSwapValidator');
  await Promise.all(pools.map((p) => swapInPool(p)));

  console.log('Making a few investments...');
  //investmentManager = await ethers.getContract('MockInvestmentManager');
  // TODO add pool type which supports investment
  //await Promise.all(pools.map((p) => investPool(p)));
  return;
}

async function investPool(pool: Contract) {
  const poolId = await pool.getPoolId();

  const vault = await ethers.getContract('Vault');
  const tokenAddresses: string[] = await vault.getPoolTokens(poolId);

  const token = tokenAddresses[0];

  await pool.authorizeAssetManager(token, investmentManager.address);
  return vault.connect(investmentManager).withdrawFromPoolBalance(poolId, token, 123);
}

async function swapInPool(pool: Contract) {
  const poolId = await pool.getPoolId();

  const vault = await ethers.getContract('Vault');
  const tokenAddresses: string[] = await vault.getPoolTokens(poolId);

  const [overallTokenIn, overallTokenOut] = tokenAddresses;

  //const Token = await ethers.getContractFactory('TestToken');
  //const token = await Token.attach(overallTokenIn);

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

async function deployPools(filteredPools: Pool[], tokens: ContractList): Promise<(Contract | undefined)[]> {
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

  const initialBPT = (100e18).toString();
  const salt = ethers.utils.id(Math.random().toString());

  const name = tokens.length + ' token pool';
  const sym = 'TESTPOOL';
  const parameters = [name, sym, initialBPT, tokens, balances, weights, swapFee, salt];

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

// Deploys a vanilla ERC20 token that can be minted by any account
async function deployToken(admin: SignerWithAddress, symbol: string, decimals?: number): Promise<string> {
  // Get deployed Token Factory
  const tokenFactory = await ethers.getContract('TokenFactory');

  const parameters = [admin.address, symbol, symbol, decimals ?? 18];

  const tx = await tokenFactory.connect(admin).create(...parameters);
  const receipt = await tx.wait();
  const event = receipt.events?.find((e: any) => e.event == 'TokenCreated');
  if (event == undefined) {
    throw new Error('Could not find TokenCreated event');
  }

  return event.args.token;
}

// Deploys multiple tokens and returns a symbol -> token dictionary
async function deployTokens(
  admin: SignerWithAddress,
  symbols: Array<string>,
  decimals: Array<number>
): Promise<ContractList> {
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
    //const address = await tokenFactory.callStatic.create(admin, symbols[i], symbols[i], decimals[i]);
    //if (!deployedTokens.includes(address)) {
    const addr = await deployToken(admin, symbols[i], decimals[i]);
    //if (addr !== address) console.log(`TOKEN DEPLOY ERROR`);
    //}
    const address = addr;
    // Get token contract
    const tokenContract = await Token.attach(address);
    tokenContracts[symbols[i]] = tokenContract;
  }

  return tokenContracts;
}
