import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp, bn } from '../../lib/helpers/numbers';
import { deploy } from '../../lib/helpers/deploy';
import { MinimalSwapInfoPool } from '../../lib/helpers/pools';
import { deploySortedTokens, TokenList } from '../../lib/helpers/tokens';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { FundManagement, Swap, SwapIn, SwapOut, toSwapIn, toSwapOut } from '../../lib/helpers/trading';

describe('Vault - swap queries', () => {
  let vault: Contract, funds: FundManagement;
  let tokens: TokenList, tokenAddresses: string[];
  let assetManagers: string[];
  let lp: SignerWithAddress;
  const poolIds: string[] = [];

  const MAX_POOLS = 2;

  before('setup', async () => {
    [, lp] = await ethers.getSigners();

    // All of the tests in this suite have no side effects, so we deploy and initially contracts only one to save time

    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await deploySortedTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];
    assetManagers = [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS];

    for (const symbol in tokens) {
      await tokens[symbol].mint(lp.address, MAX_UINT128.div(2));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT128);
    }

    for (let i = 0; i < MAX_POOLS; ++i) {
      const pool = await deploy('MockPool', { args: [vault.address, MinimalSwapInfoPool] });
      await pool.setMultiplier(fp(2));

      const poolId = await pool.getPoolId();

      await pool.setMultiplier(fp(2));

      await pool.registerTokens(tokenAddresses, assetManagers);

      await pool.setOnJoinExitPoolReturnValues(
        tokenAddresses.map(() => bn(100e18)),
        tokenAddresses.map(() => 0)
      );

      await vault.connect(lp).joinPool(
        poolId,
        lp.address,
        tokenAddresses,
        tokenAddresses.map(() => MAX_UINT256),
        false,
        '0x'
      );

      poolIds.push(poolId);
    }

    funds = {
      recipient: ZERO_ADDRESS,
      fromInternalBalance: false,
      toInternalBalance: false,
    };
  });

  type SwapData = {
    poolIdIndex: number;
    tokenInIndex: number;
    tokenOutIndex: number;
    amount: number;
  };

  function swapsDataToSwaps(swapsData: SwapData[]): Swap[] {
    return swapsData.map((swapData) => {
      return {
        poolId: poolIds[swapData.poolIdIndex],
        tokenInIndex: swapData.tokenInIndex,
        tokenOutIndex: swapData.tokenOutIndex,
        amount: swapData.amount,
        userData: '0x',
      };
    });
  }

  describe('given in', () => {
    function assertQueryBatchSwapGivenIn(swapsData: SwapData[], expectedDeltas: number[]) {
      it('returns the expected amounts', async () => {
        const swaps: SwapIn[] = toSwapIn(swapsDataToSwaps(swapsData));

        const deltas = await vault.callStatic.queryBatchSwapGivenIn(swaps, tokenAddresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas.map(bn));
      });
    }

    describe('single swap', () => {
      assertQueryBatchSwapGivenIn(
        [
          {
            poolIdIndex: 0,
            tokenInIndex: 0,
            tokenOutIndex: 1,
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
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 5,
          },
          {
            poolIdIndex: 1,
            tokenInIndex: 0,
            tokenOutIndex: 1,
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
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 5,
          },
          {
            poolIdIndex: 1,
            tokenInIndex: 1,
            tokenOutIndex: 2,
            amount: 0,
          },
        ],
        [5, 0, -20]
      );
    });
  });

  describe('given out', () => {
    function assertQueryBatchSwapGivenOut(swapsData: SwapData[], expectedDeltas: number[]) {
      it('returns the expected amounts', async () => {
        const swaps: SwapOut[] = toSwapOut(swapsDataToSwaps(swapsData));

        const deltas = await vault.callStatic.queryBatchSwapGivenOut(swaps, tokenAddresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas.map(bn));
      });
    }

    describe('single swap', () => {
      assertQueryBatchSwapGivenOut(
        [
          {
            poolIdIndex: 0,
            tokenInIndex: 0,
            tokenOutIndex: 1,
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
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 10,
          },
          {
            poolIdIndex: 1,
            tokenInIndex: 0,
            tokenOutIndex: 1,
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
            tokenInIndex: 0,
            tokenOutIndex: 1,
            amount: 20,
          },
          {
            poolIdIndex: 1,
            tokenInIndex: 2,
            tokenOutIndex: 0,
            amount: 0,
          },
        ],
        [0, -20, 5]
      );
    });
  });

  describe('helper', () => {
    it('reverts when called directly', async () => {
      const swaps: Swap[] = [
        {
          poolId: poolIds[0],
          tokenInIndex: 0,
          tokenOutIndex: 1,
          amount: 5,
          userData: '0x',
        },
      ];

      await expect(vault.queryBatchSwapHelper(swaps, tokenAddresses, funds, 0)).to.be.revertedWith(
        'Caller is not the Vault'
      );
    });
  });
});
