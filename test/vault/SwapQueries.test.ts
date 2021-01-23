import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../scripts/helpers/deploy';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';
import { MinimalSwapInfoPool } from '../../scripts/helpers/pools';
import { FundManagement, Swap, SwapIn, SwapOut, toSwapIn, toSwapOut } from '../../scripts/helpers/trading';

import { deployTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT128, MAX_UINT256, ZERO_ADDRESS } from '../helpers/constants';
import { bn } from '../helpers/numbers';

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
    tokens = await deployTokens(['DAI', 'MKR', 'SNX'], [18, 18, 18]);
    tokenAddresses = [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address];
    assetManagers = [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS];

    for (const symbol in tokens) {
      await tokens[symbol].mint(lp.address, MAX_UINT128.div(2));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT128);
    }

    for (let i = 0; i < MAX_POOLS; ++i) {
      const pool = await deploy('MockPool', { args: [vault.address, MinimalSwapInfoPool] });
      await pool.setMultiplier(toFixedPoint(2));

      const poolId = await pool.getPoolId();

      await pool.setMultiplier(toFixedPoint(2));

      // We sort the tokens when joining to avoid issues with two token pools - since this MockPool ignores Pool
      // balances and we join with equal amounts, this doesn't cause any difference.
      const sortedTokenAddresses = [...tokenAddresses].sort((tokenA, tokenB) =>
        tokenA.toLowerCase() > tokenB.toLowerCase() ? 1 : -1
      );

      await pool.registerTokens(sortedTokenAddresses, assetManagers);

      await pool.setOnJoinExitPoolReturnValues(
        sortedTokenAddresses.map((_) => bn(100e18)),
        sortedTokenAddresses.map((_) => 0)
      );

      await vault.connect(lp).joinPool(
        poolId,
        lp.address,
        sortedTokenAddresses,
        sortedTokenAddresses.map((_) => MAX_UINT256),
        false,
        '0x'
      );

      poolIds.push(poolId);
    }

    funds = {
      recipient: ZERO_ADDRESS,
      withdrawFromInternalBalance: false,
      depositToInternalBalance: false,
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
    function assertQueryBatchSwapGivenIn(swapsData: SwapData[], expectedDeltas: BigNumber[]) {
      it('returns the expected amounts', async () => {
        const swaps: SwapIn[] = toSwapIn(swapsDataToSwaps(swapsData));

        const deltas = await vault.callStatic.queryBatchSwapGivenIn(swaps, tokenAddresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas);
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
        toBigNumberArray([5, -10, 0])
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
        toBigNumberArray([10, -20, 0])
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
        toBigNumberArray([5, 0, -20])
      );
    });
  });

  describe('given out', () => {
    function assertQueryBatchSwapGivenOut(swapsData: SwapData[], expectedDeltas: BigNumber[]) {
      it('returns the expected amounts', async () => {
        const swaps: SwapOut[] = toSwapOut(swapsDataToSwaps(swapsData));

        const deltas = await vault.callStatic.queryBatchSwapGivenOut(swaps, tokenAddresses, funds);
        expect(deltas).to.deep.equal(expectedDeltas);
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
        toBigNumberArray([5, -10, 0])
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
        toBigNumberArray([10, -20, 0])
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
        toBigNumberArray([0, -20, 5])
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

function toBigNumberArray(values: (number | string)[]): BigNumber[] {
  const bigNumbers = [];
  for (const value of values) {
    bigNumbers.push(BigNumber.from(value.toString()));
  }
  return bigNumbers;
}
