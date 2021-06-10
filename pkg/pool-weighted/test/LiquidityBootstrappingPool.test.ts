import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { BigNumberish, decimal, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_INT22, MAX_UINT10, MAX_UINT31, MAX_UINT64, MIN_INT22 } from '@balancer-labs/v2-helpers/src/constants';
import {
  MINUTE,
  advanceTime,
  currentTimestamp,
  lastBlockNumber,
  setNextBlockTimestamp,
} from '@balancer-labs/v2-helpers/src/time';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import { Sample } from '@balancer-labs/v2-helpers/src/models/pools/weighted/types';

import { itBehavesAsWeightedPool } from './BaseWeightedPool.behavior';

// eslint-disable-next-line @typescript-eslint/no-empty-function
describe('LiquidityBootstrappingPool', function () {
  describe('as a 2-token weighted pool', () => {
    itBehavesAsWeightedPool(2);
  });

  let trader: SignerWithAddress,
    admin: SignerWithAddress,
    other: SignerWithAddress,
    lp: SignerWithAddress,
    owner: SignerWithAddress;

  before('setup signers', async () => {
    [, lp, trader, other, owner, admin] = await ethers.getSigners();
  });

  let tokens: TokenList;

  sharedBeforeEach('deploy tokens', async () => {
    tokens = await TokenList.create(['MKR', 'DAI'], { sorted: true });
    await tokens.mint({ to: [lp, trader], amount: fp(100) });
  });

  let pool: WeightedPool;
  const weights = [fp(30), fp(70)];
  const initialBalances = [fp(0.9), fp(1.8)];

  sharedBeforeEach('deploy pool', async () => {
    const params = { tokens, weights, owner, lbp: true, swapEnabledOnStart: true };
    pool = await WeightedPool.create(params);
  });

  const initializePool = () => {
    sharedBeforeEach('initialize pool', async () => {
      await pool.init({ initialBalances, recipient: lp });
    });
  };

  describe('weights', () => {
    it('sets token weights', async () => {
      const normalizedWeights = await pool.getNormalizedWeights();

      expect(normalizedWeights).to.equalWithError(pool.normalizedWeights, 0.0000001);
    });
  });
});
