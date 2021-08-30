import { ethers } from 'hardhat';
import { expect } from 'chai';
import { fp, arraySub } from '@balancer-labs/v2-helpers/src/numbers';
import { BigNumber, Contract } from 'ethers';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { JoinResult, WeightedPoolType } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { SwapKind } from '@balancer-labs/balancer-js';
import { FundManagement } from '@balancer-labs/balancer-js/src/types';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

import { range } from 'lodash';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('InvestmentPool', function () {
  let allTokens: TokenList;
  let assetManager: SignerWithAddress;
  let owner: SignerWithAddress;
  let admin: SignerWithAddress;
  let lp: SignerWithAddress;
  let trader: SignerWithAddress;
  let vault: Vault;
  let funds: FundManagement;

  const MAX_TOKENS = 100;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const PROTOCOL_SWAP_FEE_PERCENTAGE = fp(0.1);
  const MANAGEMENT_FEE_PERCENTAGE = fp(0.2);
  const WEIGHTS = range(10000, 10000 + MAX_TOKENS); // These will be normalized to weights that are close to each other, but different

  before('setup signers', async () => {
    [, admin, owner, assetManager, lp, trader] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and tokens', async () => {
    vault = await Vault.create({ admin });
    allTokens = await TokenList.create(MAX_TOKENS, { sorted: true, varyDecimals: true });

    funds = {
      sender: trader.address,
      recipient: trader.address,
      fromInternalBalance: false,
      toInternalBalance: false,
    };
  });

  describe('asset managers', () => {
    let factory: Contract;
    let tokens: TokenList;
    let validWeights: BigNumber[];
    let validManagers: string[];

    sharedBeforeEach('deploy factory & tokens', async () => {
      factory = await deploy('InvestmentPoolFactory', { args: [vault.address] });

      tokens = await TokenList.create(['MKR', 'DAI', 'SNX', 'BAT'], { sorted: true });

      validWeights = Array(tokens.length).fill(fp(1 / tokens.length));
      validManagers = Array(tokens.length).fill(assetManager.address);
    });

    async function createPool(
      weights: BigNumber[] = validWeights,
      assetManagers: string[] = validManagers
    ): Promise<Contract> {
      const receipt = await (
        await factory.create(
          'Balancer Investment Pool',
          'INV-BPT',
          tokens.addresses,
          weights,
          assetManagers,
          POOL_SWAP_FEE_PERCENTAGE,
          owner.address,
          MANAGEMENT_FEE_PERCENTAGE
        )
      ).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      return deployedAt('InvestmentPool', event.args.pool);
    }

    it('should have asset managers', async () => {
      const pool = await createPool();
      const poolId = await pool.getPoolId();

      await tokens.asyncEach(async (token) => {
        const info = await vault.getPoolTokenInfo(poolId, token);
        expect(info.assetManager).to.equal(assetManager.address);
      });
    });

    it('should fail if weights wrong length', async () => {
      const badWeights = Array(MAX_TOKENS).fill(fp(0.01));
      await expect(createPool(badWeights)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });

    it('should fail if asset managers wrong length', async () => {
      const badManagers = Array(MAX_TOKENS).fill(assetManager.address);

      await expect(createPool(validWeights, badManagers)).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
    });
  });

  describe('weights and scaling factors', () => {
    for (const numTokens of range(2, MAX_TOKENS + 1)) {
      context(`with ${numTokens} tokens`, () => {
        let pool: WeightedPool;
        let tokens: TokenList;

        sharedBeforeEach('deploy pool', async () => {
          tokens = allTokens.subset(numTokens);

          pool = await WeightedPool.create({
            poolType: WeightedPoolType.INVESTMENT_POOL,
            tokens,
            weights: WEIGHTS.slice(0, numTokens),
            swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
            managementFeePercentage: MANAGEMENT_FEE_PERCENTAGE,
          });
        });

        it('sets token weights', async () => {
          const normalizedWeights = await pool.getNormalizedWeights();

          for (let i = 0; i < numTokens; i++) {
            expectEqualWithError(normalizedWeights[i], pool.normalizedWeights[i], 0.0000001);
          }
        });

        it('sets scaling factors', async () => {
          const poolScalingFactors = await pool.getScalingFactors();
          const tokenScalingFactors = tokens.map((token) => fp(10 ** (18 - token.decimals)));

          expect(poolScalingFactors).to.deep.equal(tokenScalingFactors);
        });
      });
    }
  });

  describe('management fees', () => {
    let pool: WeightedPool;
    let joinResult: JoinResult;
    let tokens: TokenList;
    const weights = [fp(0.2), fp(0.8)];
    const initialBalances = [fp(100), fp(400)];
    const numTokens = 2;

    sharedBeforeEach('mint tokens to lp and trader', async () => {
      await allTokens.mint({ to: lp, amount: fp(1000) });
      await allTokens.mint({ to: trader, amount: fp(1000) });

      tokens = allTokens.subset(numTokens);

      await tokens.approve({ to: vault.address, from: [lp, trader] });
    });

    context('when there is only a protocol fee', () => {
      sharedBeforeEach('deploy pool without management fee, and set protocol fee', async () => {
        await vault.setSwapFeePercentage(PROTOCOL_SWAP_FEE_PERCENTAGE, { from: admin });

        pool = await WeightedPool.create({
          vault,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          tokens,
          weights: weights,
          swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          managementFeePercentage: 0,
        });

        joinResult = await pool.init({ from: lp, recipient: lp, initialBalances });
      });

      it('sets the protocol fee', async () => {
        const swapFeePercentage = await vault.getSwapFeePercentage();
        expect(swapFeePercentage).to.equal(PROTOCOL_SWAP_FEE_PERCENTAGE);
      });

      it('has no management fee', async () => {
        const managementFeePercentage = await pool.getManagementFeePercentage();
        expect(managementFeePercentage).to.equal(0);
      });

      it('has expected balances', async () => {
        expect(joinResult.amountsIn).to.deep.equal(initialBalances);
      });

      context('after swaps', () => {
        sharedBeforeEach('do some swaps', async () => {
          const singleSwapTo = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[1],
            assetOut: tokens.addresses[0],
            amount: fp(20),
            userData: '0x',
          };

          const singleSwapFro = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[0],
            assetOut: tokens.addresses[1],
            amount: fp(20),
            userData: '0x',
          };

          for (let i = 0; i < 10; i++) {
            await vault.instance.connect(trader).swap(singleSwapTo, funds, 0, MAX_UINT256);
            await vault.instance.connect(trader).swap(singleSwapFro, funds, 0, MAX_UINT256);
          }

          await pool.joinGivenIn({ from: lp, amountsIn: [fp(100), fp(400)] });
        });

        it('does not charge management fees', async () => {
          const managementFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);
          expect(managementFeeAmounts).to.be.zeros;
        });
      });
    });

    context('when there is only a management fee', () => {
      let weightedMath: Contract;

      sharedBeforeEach('deploy pool with management fee', async () => {
        pool = await WeightedPool.create({
          vault,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          tokens,
          weights: weights,
          swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          managementFeePercentage: MANAGEMENT_FEE_PERCENTAGE,
        });

        joinResult = await pool.init({ from: lp, recipient: lp, initialBalances });

        weightedMath = await deploy('MockWeightedMath');
      });

      it('has no protocol fee', async () => {
        const swapFeePercentage = await vault.getSwapFeePercentage();
        expect(swapFeePercentage).to.equal(0);
      });

      it('sets the management fee', async () => {
        const managementFeePercentage = await pool.getManagementFeePercentage();
        expect(managementFeePercentage).to.equal(MANAGEMENT_FEE_PERCENTAGE);
      });

      it('has expected balances', async () => {
        expect(joinResult.amountsIn).to.deep.equal(initialBalances);
      });

      context('after swaps', () => {
        let previousInvariant: BigNumber;
        let currentInvariant: BigNumber;

        sharedBeforeEach('do some swaps', async () => {
          const singleSwapTo = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[1],
            assetOut: tokens.addresses[0],
            amount: fp(20),
            userData: '0x',
          };

          const singleSwapFro = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[0],
            assetOut: tokens.addresses[1],
            amount: fp(20),
            userData: '0x',
          };

          for (let i = 0; i < 10; i++) {
            // This requires the MockVault - but if I use that, I can't set protocol fees!
            //
            //await pool.swapGivenIn({ from: trader, recipient: trader, in: 1, out: 0, amount: fp(20) });
            //await pool.swapGivenIn({ from: trader, recipient: trader, in: 0, out: 1, amount: fp(20) });

            await vault.instance.connect(trader).swap(singleSwapTo, funds, 0, MAX_UINT256);
            await vault.instance.connect(trader).swap(singleSwapFro, funds, 0, MAX_UINT256);
          }
        });

        it('collects management fees', async () => {
          //console.log(`Token 0 has ${tokens.get(0).decimals} decimals.`);
          //console.log(`Token 1 has ${tokens.get(1).decimals} decimals.`);

          // Shouldn't be any protocol fees
          const collectedFees = await vault.getCollectedFeeAmounts(tokens);
          expect(collectedFees).to.be.zeros;

          const balances = await pool.getBalances();
          // These balances need to be scaled to match the contract code
          const scaledBalances = balances.map((balance, i) => balance.mul(10 ** (18 - tokens.get(i).decimals)));
          const normalizedWeights = await pool.getNormalizedWeights();

          previousInvariant = await pool.getLastInvariant();
          currentInvariant = await weightedMath.invariant(normalizedWeights, scaledBalances);

          await pool.joinGivenIn({ from: lp, amountsIn: [fp(100), fp(400)] });

          // What should the fee be? - use MockWeightedMath
          const expectedFee = await weightedMath.calculateDueTokenProtocolSwapFeeAmount(
            balances[1],
            normalizedWeights[1],
            previousInvariant,
            currentInvariant,
            MANAGEMENT_FEE_PERCENTAGE.div(100)
          );

          const managementFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);

          expect(managementFeeAmounts[0]).to.equal(0);
          expect(managementFeeAmounts[1]).to.equalWithError(expectedFee, 0.0000001);
        });
      });
    });

    context('when there are both management and protocol fees', () => {
      sharedBeforeEach('deploy pool with management fee', async () => {
        await vault.setSwapFeePercentage(PROTOCOL_SWAP_FEE_PERCENTAGE, { from: admin });

        pool = await WeightedPool.create({
          vault,
          poolType: WeightedPoolType.INVESTMENT_POOL,
          tokens,
          weights: weights,
          swapFeePercentage: POOL_SWAP_FEE_PERCENTAGE,
          managementFeePercentage: MANAGEMENT_FEE_PERCENTAGE,
          owner,
        });

        joinResult = await pool.init({ from: lp, recipient: lp, initialBalances });
      });

      it('sets the protocol fee', async () => {
        const swapFeePercentage = await vault.getSwapFeePercentage();
        expect(swapFeePercentage).to.equal(PROTOCOL_SWAP_FEE_PERCENTAGE);

        const collector: Contract = await vault.getFeesCollector();
        const pct = await collector.getSwapFeePercentage();
        expect(pct).to.equal(PROTOCOL_SWAP_FEE_PERCENTAGE);
      });

      it('sets the management fee', async () => {
        const managementFeePercentage = await pool.getManagementFeePercentage();
        expect(managementFeePercentage).to.equal(MANAGEMENT_FEE_PERCENTAGE);
      });

      it('has expected balances', async () => {
        expect(joinResult.amountsIn).to.deep.equal(initialBalances);
      });

      context('after swaps', () => {
        sharedBeforeEach('do some swaps', async () => {
          const singleSwapTo = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[1],
            assetOut: tokens.addresses[0],
            amount: fp(20),
            userData: '0x',
          };

          const singleSwapFro = {
            poolId: pool.getPoolId(),
            kind: SwapKind.GivenIn,
            assetIn: tokens.addresses[0],
            assetOut: tokens.addresses[1],
            amount: fp(20),
            userData: '0x',
          };

          for (let i = 0; i < 10; i++) {
            // This requires the MockVault - but if I use that, I can't set protocol fees!
            //
            //await pool.swapGivenIn({ from: trader, recipient: trader, in: 1, out: 0, amount: fp(20) });
            //await pool.swapGivenIn({ from: trader, recipient: trader, in: 0, out: 1, amount: fp(20) });

            await vault.instance.connect(trader).swap(singleSwapTo, funds, 0, MAX_UINT256);
            await vault.instance.connect(trader).swap(singleSwapFro, funds, 0, MAX_UINT256);
          }

          await pool.joinGivenIn({ from: lp, amountsIn: [fp(100), fp(400)] });
        });

        it('collects management fees', async () => {
          //console.log(`Token 0 has ${tokens.get(0).decimals} decimals.`);
          //console.log(`Token 1 has ${tokens.get(1).decimals} decimals.`);

          // Fees will be collected from the highest weight token; so token[0] will be 0
          // token[1] will be the amount of protocol fees * managmentFeePct/protocolFeePct
          // So with 10% protocol fees and 20% management fees, it's 20/10 = 2 (i.e., mgmt fee should be double the protocol fee)
          const ratio = MANAGEMENT_FEE_PERCENTAGE.div(PROTOCOL_SWAP_FEE_PERCENTAGE);

          const collectedFees = await vault.getCollectedFeeAmounts(tokens);
          const expectedAmounts = collectedFees.map((fee) => fee.mul(ratio));

          const managementFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);
          for (let i = 0; i < tokens.length; i++) {
            expect(managementFeeAmounts[i]).to.equalWithError(expectedAmounts[i], 0.0000001);
          }
        });

        it('allows the owner to collect fees', async () => {
          const managementFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);
          const previousBalances: BigNumber[] = [];
          const currentBalances: BigNumber[] = [];

          for (let i = 0; i < tokens.length; i++) {
            previousBalances[i] = await tokens.get(i).balanceOf(owner);
          }

          const { amountsOut } = await pool.exitForManagementFees({ from: owner });

          for (let i = 0; i < tokens.length; i++) {
            expect(amountsOut[i]).to.equalWithError(managementFeeAmounts[i], 0.0000001);
            currentBalances[i] = await tokens.get(i).balanceOf(owner);
          }

          expect(arraySub(currentBalances, previousBalances)).to.deep.equal(amountsOut);

          // After we withdraw them, they should be 0
          const residualFeeAmounts = await pool.getCollectedManagementFeeAmounts(tokens.addresses);
          expect(residualFeeAmounts).to.be.zeros;
        });
      });
    });
  });
});
