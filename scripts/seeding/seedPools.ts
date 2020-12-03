import * as hre from 'hardhat';
import { ethers } from 'hardhat';
import { deployTokens, TokenList } from '../../test/helpers/tokens';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { SignerWithAddress } from 'hardhat-deploy-ethers/dist/src/signer-with-address';
import { BigNumber } from 'ethers';

const allPools = require('./allPools.json');

let controller: SignerWithAddress;
let trader: SignerWithAddress;

interface Pool {
    id: string;
    finalized: Boolean;
    publicSwap: Boolean;
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

// % npx hardhat run scripts/seeding/seedPools.ts --network localhost
async function main() {

  [, controller, trader] = await ethers.getSigners();

  // Get deployed vault
  const vault = await ethers.getContract('Vault');

  // Format pools to BigNumber/scaled format
  const formattedPools: Pool[] = formatPools(allPools);

  // Currently filters pools by top 50 liquidity
  const filteredPools: Pool[] = filterPools(formattedPools);

  // Get token symbols and decimals to deploy test tokens
  let [symbols, decimals] = getTokenInfoForDeploy(filteredPools);

  // TODO: Use WETH9 Contract - Mike will probably include this as part of deploy
  console.log(`\nDeploying tokens...`)
  // Deploy tokens
  let tokens: TokenList = await deployTokens(controller.address, symbols, decimals);

  console.log(`Deployed Tokens:`);
  symbols.forEach(symbol => {
    console.log(`${symbol} - ${tokens[symbol].address}`);
  })
  // Set max approval for each token being used
  symbols.forEach(async (symbol, index) => {
    await tokens[symbol].approve(vault.address, MAX_UINT256);
  })

  console.log(`\nDeploying Pools using vault: ${vault.address}`);
  await deployPools(filteredPools, tokens);

  return;
}

async function deployPools(filteredPools: Pool[], tokens: TokenList){

  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  for(let i = 0;i < filteredPools.length;i++){
    let tokensList: Array<string> = [];
    let weights: Array<BigNumber> = [];
    let balances: Array<BigNumber> = [];
    let swapFee: BigNumber = filteredPools[i].swapFee;

    console.log(`\nNew Pool With ${filteredPools[i].tokens.length} tokens`);
    console.log(`SwapFee: ${swapFee.toString()}\nTokens:`);
    for(let j = 0;j < filteredPools[i].tokens.length;j++){
      tokensList.push(tokens[filteredPools[i].tokens[j].symbol].address);
      console.log(`${filteredPools[i].tokens[j].symbol} - ${tokens[filteredPools[i].tokens[j].symbol].address} ${filteredPools[i].tokens[j].balance.toString()}`);
      weights.push(filteredPools[i].tokens[j].denormWeight);
      balances.push(filteredPools[i].tokens[j].balance);
      // Mint required tokens for pool
      await tokens[filteredPools[i].tokens[j].symbol].mint(deployer, filteredPools[i].tokens[j].balance);
    }

    // Deploy strategy, pool and provide liquidity
    await deployStrategyPool(tokensList, weights, balances, swapFee, deployer);
    // break;
  }
}

// Deploy strategy then newPool with that strategy
// Finally Add liquidity to pool
async function deployStrategyPool(tokens: Array<string>, weights: Array<BigNumber>, balances: Array<BigNumber>, swapFee: BigNumber, deployer: string){
  const { deployments } = hre;
  const { deploy } = deployments;

  const cwpFactory = await deployments.getOrNull('CWPFactory');
  const vault = await deployments.getOrNull('Vault');
  if(!cwpFactory || !vault){
    console.log('CWPFactory and/or Vault Contracts Not Deployed.');
    return;
  }

  // Deploy strategy using existing factory
  let receipt = await deployments.execute('CWPFactory', { from: deployer }, 'create', tokens, weights, swapFee);
  let event = receipt.events?.find((e) => e.event == 'StrategyCreated');
  if (event == undefined) {
    throw new Error('Could not find StrategyCreated event');
  }

  const strategyAddr = event.args.strategy;
  console.log(`Strategy deployed at: ${strategyAddr}`);

  let strategyType = 0; // 0 for Pair
  if(tokens.length > 2)
    strategyType = 1;

  // Create new pool with strategy
  receipt = await deployments.execute('Vault', { from: deployer }, 'newPool', strategyAddr, strategyType);
  event = receipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  const poolId = event.args.poolId;
  console.log(`New Pool ID: ${event.args.poolId}`);

  // Token approval should already be done for vault
  // Add liquidity using pull method
  receipt = await deployments.execute('Vault', { from: deployer }, 'addLiquidity', poolId, deployer, tokens, balances, balances)

  // console.log(receipt);
}

// Convert all pools to BigNumber/scaled format
function formatPools(allPools: any): Pool[]{
  let formattedPools: Pool[] = [];
  for(let i = 0;i < allPools.pools.length;i++){

    if(allPools.pools[i].tokens.length < 2){
      continue;
    }

    let tokens: Token[] = [];
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
    for(let j = 0;j < allPools.pools[i].tokens.length;j++){
        const token: Token = {
          balance: ethers.utils.parseUnits(allPools.pools[i].tokens[j].balance, Number(allPools.pools[i].tokens[j].decimals)),
          decimals: Number(allPools.pools[i].tokens[j].decimals),
          denormWeight: ethers.utils.parseUnits(allPools.pools[i].tokens[j].denormWeight, 18),
          symbol: allPools.pools[i].tokens[j].symbol,
          name: allPools.pools[i].tokens[j].name,
          address: allPools.pools[i].tokens[j].address,
        }

        pool.tokens.push(token);
    };

    formattedPools.push(pool);
  };

  return formattedPools;
}

function filterPools(allPools: Pool[]): Pool[]{
  // Order by liquidity
  allPools.sort((a, b) => b.liquidity - a.liquidity);

  return allPools.slice(0, 50);
}

// Find array of token symbols, decimals and total balances for pools of interest
function getTokenInfoForDeploy(pools: Pool[]): [Array<string>, Array<number>]{
  let symbols: Array<string> = [];
  let decimals: Array<number> = [];

  let buckets: any = {};
  // for each pool check tokens, if not exists add to list
  for(let i = 0;i < pools.length;i++){
    for(let j = 0;j < pools[i].tokens.length;j++){
        if(!buckets[pools[i].tokens[j].address])
          buckets[pools[i].tokens[j].address] = pools[i].tokens[j];
    }
  }

  for (const key in buckets) {
    symbols.push(buckets[key].symbol);
    decimals.push(buckets[key].decimals);
  }

  return [symbols, decimals];
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
