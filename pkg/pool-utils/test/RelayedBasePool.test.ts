import { expect } from 'chai';
import { Contract } from 'ethers';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('RelayedBasePool', function () {
  let vault: Vault, relayer: Contract, pool: Contract, tokens: TokenList;

  sharedBeforeEach('deploy pool', async () => {
    vault = await Vault.create();
    relayer = await deploy('MockBasePoolRelayer');
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
    pool = await deploy('MockRelayedBasePool', {
      args: [
        vault.address,
        GeneralPool,
        'BPT',
        'BPT',
        tokens.addresses,
        Array(tokens.length).fill(ZERO_ADDRESS),
        fp(0.1),
        0,
        0,
        relayer.address,
        ZERO_ADDRESS,
      ],
    });
  });

  describe('relayer', () => {
    it('uses the given relayer', async () => {
      expect(await pool.relayer()).to.be.equal(relayer.address);
    });
  });

  describe('join', () => {
    const join = async () => {
      return vault.joinPool({
        poolAddress: pool.address,
        poolId: await pool.getPoolId(),
        recipient: ZERO_ADDRESS,
        currentBalances: Array(tokens.length).fill(fp(1000)),
        tokens: tokens.addresses,
        lastChangeBlock: 0,
        protocolFeePercentage: 0,
        data: '0x',
      });
    };

    context('when the relayer tells it has not called the pool', () => {
      sharedBeforeEach('mock relayer', async () => {
        await relayer.mockHasCalledPool(false);
      });

      it('reverts', async () => {
        await expect(join()).to.be.revertedWith('BASE_POOL_RELAYER_NOT_CALLED');
      });
    });

    context('when the relayer tells it has called the pool', () => {
      sharedBeforeEach('mock relayer', async () => {
        await relayer.mockHasCalledPool(true);
      });

      it('does not revert', async () => {
        await expect(join()).not.to.be.reverted;
      });
    });
  });

  describe('exit', () => {
    const exit = async () => {
      return vault.exitPool({
        poolAddress: pool.address,
        poolId: await pool.getPoolId(),
        recipient: ZERO_ADDRESS,
        currentBalances: Array(tokens.length).fill(fp(1000)),
        tokens: tokens.addresses,
        lastChangeBlock: 0,
        protocolFeePercentage: 0,
        data: '0x',
      });
    };

    context('when the relayer tells it has not called the pool', () => {
      sharedBeforeEach('mock relayer', async () => {
        await relayer.mockHasCalledPool(false);
      });

      it('reverts', async () => {
        await expect(exit()).to.be.revertedWith('BASE_POOL_RELAYER_NOT_CALLED');
      });
    });

    context('when the relayer tells it has called the pool', () => {
      sharedBeforeEach('mock relayer', async () => {
        await relayer.mockHasCalledPool(true);
      });

      it('does not revert', async () => {
        await exit();
      });
    });
  });
});
