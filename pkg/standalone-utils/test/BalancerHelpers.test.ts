import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT112, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';

describe('BalancerHelpers', function () {
  let helper: Contract, vault: Vault, pool: WeightedPool, tokens: TokenList, lp: SignerWithAddress;

  const initialBalances = [fp(20), fp(30)];

  before('setup signers', async () => {
    [, lp] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy and initialize pool', async () => {
    tokens = await TokenList.create(2, { sorted: true });
    pool = await WeightedPool.create({ tokens, swapFeePercentage: fp(0.000001), fromFactory: true });
    vault = pool.vault;

    await tokens.mint({ to: lp, amount: fp(100) });
    await tokens.approve({ from: lp, to: vault.address, amount: fp(100) });
    await pool.init({ initialBalances, from: lp });
  });

  sharedBeforeEach('deploy helper', async () => {
    helper = await deploy('BalancerHelpers', { args: [pool.vault.address] });
  });

  describe('queryJoin', () => {
    // These two values are superfluous, as they are not used by the helper
    const fromInternalBalance = false;
    const maxAmountsIn: BigNumber[] = [MAX_UINT112, MAX_UINT112];

    it('can query join results', async () => {
      const amountsIn = [fp(1), fp(0)];
      const expectedBptOut = await pool.estimateBptOut(amountsIn, initialBalances);

      const data = WeightedPoolEncoder.joinExactTokensInForBPTOut(amountsIn, 0);
      const result = await helper.queryJoin(pool.poolId, ZERO_ADDRESS, ZERO_ADDRESS, {
        assets: tokens.addresses,
        maxAmountsIn,
        fromInternalBalance: false,
        userData: data,
      });

      expect(result.amountsIn).to.deep.equal(amountsIn);
      expect(result.bptOut).to.be.equalWithError(expectedBptOut, 0.0001);
    });

    it('bubbles up revert reasons', async () => {
      const data = WeightedPoolEncoder.joinInit(initialBalances);
      const tx = helper.queryJoin(pool.poolId, ZERO_ADDRESS, ZERO_ADDRESS, {
        assets: tokens.addresses,
        maxAmountsIn: maxAmountsIn,
        fromInternalBalance: fromInternalBalance,
        userData: data,
      });

      await expect(tx).to.be.revertedWith('UNHANDLED_JOIN_KIND');
    });
  });

  describe('queryExit', () => {
    let bptIn: BigNumber, expectedAmountsOut: BigNumber[], data: string;

    // This value is superfluous, as it is not used by the helper
    const minAmountsOut: BigNumber[] = [];

    sharedBeforeEach('estimate expected amounts out', async () => {
      bptIn = (await pool.totalSupply()).div(2);
      expectedAmountsOut = initialBalances.map((balance) => balance.div(2));
      data = WeightedPoolEncoder.exitExactBPTInForTokensOut(bptIn);
    });

    it('can query exit results', async () => {
      const result = await helper.queryExit(pool.poolId, ZERO_ADDRESS, ZERO_ADDRESS, {
        assets: tokens.addresses,
        minAmountsOut,
        toInternalBalance: false,
        userData: data,
      });

      expect(result.bptIn).to.equal(bptIn);
      expect(result.amountsOut).to.be.lteWithError(expectedAmountsOut, 0.00001);
    });

    it('bubbles up revert reasons', async () => {
      const tooBigIndex = 90;
      const data = WeightedPoolEncoder.exitExactBPTInForOneTokenOut(bptIn, tooBigIndex);
      const tx = helper.queryExit(pool.poolId, ZERO_ADDRESS, ZERO_ADDRESS, {
        assets: tokens.addresses,
        minAmountsOut,
        toInternalBalance: false,
        userData: data,
      });

      await expect(tx).to.be.revertedWith('OUT_OF_BOUNDS');
    });
  });
});
