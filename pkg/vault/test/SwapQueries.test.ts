import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';

import { BatchSwapStep, FundManagement, SwapKind } from '@balancer-labs/balancer-js';
import { fp, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { MAX_UINT112, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

describe('Swap Queries', () => {
  let vault: Contract, funds: FundManagement;
  let tokens: TokenList;
  let lp: SignerWithAddress;
  const poolIds: string[] = [];

  const MAX_POOLS = 2;

  before('setup', async () => {
    [, lp] = await ethers.getSigners();

    // All of the tests in this suite have no side effects, so we deploy and initially contracts only one to save time
    vault = await deploy('Vault', { args: [ZERO_ADDRESS, ZERO_ADDRESS, 0, 0] });

    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
    await tokens.mint({ to: lp, amount: MAX_UINT112.div(2) });
    await tokens.approve({ to: vault, amount: MAX_UINT112, from: lp });

    for (let i = 0; i < MAX_POOLS; ++i) {
      const pool = await deploy('MockPool', { args: [vault.address, PoolSpecialization.MinimalSwapInfoPool] });
      const poolId = await pool.getPoolId();

      await pool.setMultiplier(fp(2));
      await pool.registerTokens(tokens.addresses, Array(tokens.length).fill(ZERO_ADDRESS));

      await vault.connect(lp).joinPool(poolId, lp.address, lp.address, {
        assets: tokens.addresses,
        maxAmountsIn: Array(tokens.length).fill(MAX_UINT256),
        fromInternalBalance: false,
        userData: encodeJoin(Array(tokens.length).fill(bn(100e18)), Array(tokens.length).fill(0)),
      });

      poolIds.push(poolId);
    }

    funds = {
      sender: vault.address,
      recipient: ZERO_ADDRESS,
      fromInternalBalance: false,
      toInternalBalance: false,
    };
  });

  type SwapData = {
    poolIdIndex: number;
    assetInIndex: number;
    assetOutIndex: number;
    amount: number;
  };

  function toSwaps(swapsData: SwapData[]): BatchSwapStep[] {
    return swapsData.map((swapData) => {
      return {
        poolId: poolIds[swapData.poolIdIndex],
        assetInIndex: swapData.assetInIndex,
        assetOutIndex: swapData.assetOutIndex,
        amount: swapData.amount,
        userData: '0x',
      };
    });
  }

  describe('given in', () => {
    function assertQueryBatchSwapGivenIn(swapsData: SwapData[], expectedDeltas: number[]) {
      it('returns the expected amounts', async () => {
        const swaps: BatchSwapStep[] = toSwaps(swapsData);
        const deltas = await vault.queryBatchSwap(SwapKind.GivenIn, swaps, tokens.addresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas.map(bn));
      });
    }

    describe('single swap', () => {
      assertQueryBatchSwapGivenIn(
        [
          {
            poolIdIndex: 0,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 5,
          },
        ],
        [5, -10, 0]
      );
    });

    describe('multiple pools', () => {
      assertQueryBatchSwapGivenIn(
        [
          {
            poolIdIndex: 0,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 5,
          },
          {
            poolIdIndex: 1,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 5,
          },
        ],
        [10, -20, 0]
      );
    });

    describe('multihop', () => {
      assertQueryBatchSwapGivenIn(
        [
          {
            poolIdIndex: 0,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 5,
          },
          {
            poolIdIndex: 1,
            assetInIndex: 1,
            assetOutIndex: 2,
            amount: 0,
          },
        ],
        [5, 0, -20]
      );
    });

    describe('error', () => {
      it('bubbles up revert reasons', async () => {
        const invalidSwap: BatchSwapStep[] = toSwaps([
          { poolIdIndex: 0, assetInIndex: 100, assetOutIndex: 1, amount: 5 },
        ]);
        const tx = vault.queryBatchSwap(SwapKind.GivenIn, invalidSwap, tokens.addresses, funds);
        await expect(tx).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });
  });

  describe('given out', () => {
    function assertQueryBatchSwapGivenOut(swapsData: SwapData[], expectedDeltas: number[]) {
      it('returns the expected amounts', async () => {
        const swaps: BatchSwapStep[] = toSwaps(swapsData);

        const deltas = await vault.queryBatchSwap(SwapKind.GivenOut, swaps, tokens.addresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas.map(bn));
      });
    }

    describe('single swap', () => {
      assertQueryBatchSwapGivenOut(
        [
          {
            poolIdIndex: 0,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 10,
          },
        ],
        [5, -10, 0]
      );
    });

    describe('multiple pools', () => {
      assertQueryBatchSwapGivenOut(
        [
          {
            poolIdIndex: 0,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 10,
          },
          {
            poolIdIndex: 1,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 10,
          },
        ],
        [10, -20, 0]
      );
    });

    describe('multihop', () => {
      assertQueryBatchSwapGivenOut(
        [
          {
            poolIdIndex: 0,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: 20,
          },
          {
            poolIdIndex: 1,
            assetInIndex: 2,
            assetOutIndex: 0,
            amount: 0,
          },
        ],
        [0, -20, 5]
      );
    });

    describe('error', () => {
      it('bubbles up revert reasons', async () => {
        const invalidSwap: BatchSwapStep[] = toSwaps([
          { poolIdIndex: 0, assetInIndex: 100, assetOutIndex: 1, amount: 5 },
        ]);
        const tx = vault.queryBatchSwap(SwapKind.GivenOut, invalidSwap, tokens.addresses, funds);
        await expect(tx).to.be.revertedWith('OUT_OF_BOUNDS');
      });
    });
  });
});
