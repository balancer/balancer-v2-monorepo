import { BigNumber, Contract, Event } from 'ethers';
import { Dictionary } from 'lodash';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deepEqual } from 'assert';

import * as allPools from './allPools.json';
import { bn, fp } from '../../helpers/numbers';
import { TokenList, deployTokens } from '../../helpers/tokens';
import { WEEK } from '../../helpers/time';
import { encodeJoinWeightedPool } from '../../helpers/weightedPoolEncoding';
import { MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { formatPools, getTokenInfoForDeploy, Pool } from './processJSON';

let ethers: any;
let deployer: SignerWithAddress;
let controller: SignerWithAddress;
let trader: SignerWithAddress;
//let validator: Contract;
let assetManager: SignerWithAddress; // This would normally be a contract

const NUM_POOLS = 10;

const decimalsByAddress: Dictionary<number> = {};

module.exports = async function action(args: any, hre: HardhatRuntimeEnvironment) {
  ethers = hre.ethers;
  [deployer, controller] = await ethers.getSigners();

  // Get deployed vault
  const vault = await ethers.getContract('Vault');
  const authorizer = await ethers.getContract('Authorizer');

  // Format pools to BigNumber/scaled format
  const formattedPools: Pool[] = formatPools(allPools);

  // Currently filters pools by top 5 liquidity
  const filteredPools: Pool[] = filterPools(formattedPools, NUM_POOLS);

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

    decimalsByAddress[token.address] = decimals[index];

    const tradingBalanceScaled = tradingBalance.div(bn(10).pow(decimals[index]));
    console.log(`${symbol}: ${token.address} ${tradingBalanceScaled}`);

    await token.connect(deployer).mint(controller.address, tradingBalance);
    await token.connect(controller).approve(vault.address, MAX_UINT256);

  }

  // console.log(`\nDeploying Pools using vault: ${vault.address}`);
  await deployPools(filteredPools, tokens);

  return;
};

// in order to keep the tokens in line with the initial balances, weights, etc
// we presort the addresses before deploying the pool
const compareAddresses = (addressA: string, addressB: string) =>
  addressA.toLowerCase() > addressB.toLowerCase() ? 1 : -1;

async function deployPools(filteredPools: Pool[], tokens: TokenList) {
  for(const p of filteredPools) {
    const tokensList: Array<string> = [];
    const weights: Array<BigNumber> = [];
    const balances: Array<BigNumber> = [];
    const swapFee: BigNumber = p.swapFee;

    p.tokens
      .sort((a, b) => compareAddresses(tokens[a.symbol].address, tokens[b.symbol].address))
      .forEach((t) => {
        // this is the address of the deployed tost token, not the original token (in the TokenJSON)
        tokensList.push(tokens[t.symbol].address);
        weights.push(t.denormWeight);
        balances.push(t.balance);
      });

    // Deploy pool and provide liquidity
    await deployStrategyPool(tokensList, weights, balances, swapFee);
  };
}

async function deployStrategyPool(
  tokens: Array<string>,
  weights: Array<BigNumber>,
  initialBalances: Array<BigNumber>,
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
  tokens.forEach((token, i) => {
    const initialBalanceScaled = initialBalances[i].div(bn(10).pow(decimalsByAddress[token]));
    console.log(`${token} - ${initialBalanceScaled.toString()}`);
  });

  const name = tokens.length + ' token pool';
  const sym = 'TESTPOOL';
  const emergencyPeriod = WEEK;
  const emergencyPeriodCheckExtension = WEEK;
  const parameters = [name, sym, tokens, weights, swapFee, emergencyPeriod, emergencyPeriodCheckExtension];

  const tx = await wpFactoryContract.connect(controller).create(...parameters);
  const receipt = await tx.wait();
  const event = receipt.events?.find((e: Event) => e.event == 'PoolRegistered');
  if (event == undefined) {
    throw new Error('Could not find PoolRegistered event');
  }
  const poolAddress = event.args.pool;
  const pool = await wpFactory.attach(poolAddress);

  console.log(`New Pool Address: ${poolAddress}`);
  await initializeStrategyPool(pool, tokens, initialBalances);
  return pool;
}

async function initializeStrategyPool(
  pool: Contract,
  tokens: Array<string>,
  initialBalances: Array<BigNumber>
  //swapFee: BigNumber
): Promise<any> {
  const vault = await ethers.getContract('Vault');

  const poolId = await pool.getPoolId();
  // Sanity check: need to make sure tokens are in sorted order in some cases
  // or joinPool will fail
  deepEqual(tokens, (await vault.getPoolTokens(poolId)).tokens);

  const recipient = controller.address;
  const maxAmountsIn = initialBalances;
  const fromInternalBalance = false;
  const initialJoinUserData = encodeJoinWeightedPool({ kind: 'Init', amountsIn: initialBalances });

  const joinTx = await vault
    .connect(controller)
    .joinPool(poolId, controller.address, recipient, tokens, maxAmountsIn, fromInternalBalance, initialJoinUserData);
  const receipt = await joinTx.wait();

  const event = receipt.events?.find((e: Event) => e.event == 'PoolJoined');
  if (event == undefined) {
    throw new Error('Could not find PoolJoined event');
  }
  return event;
}

function filterPools(allPools: Pool[], count: number): Pool[] {
  // Order by liquidity
  allPools.sort((a, b) => b.liquidity - a.liquidity);

  const start = 0;
  return allPools.slice(start, start + count);
}
