import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

describe('RebalancedBasePool', function () {
  let user: SignerWithAddress;
  let vault: Vault, relayer: Contract, pool: Contract, tokens: TokenList, assetManagers: Contract[];

  before('set signer', async () => {
    [, user] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy pool', async () => {
    vault = await Vault.create();
    relayer = await deploy('MockRebalancedBasePoolRelayer');
    tokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
    await tokens.mint({ to: user, amount: fp(50) });
    await tokens.approve({ to: vault.instance, amount: fp(1000), from: user });

    assetManagers = [
      await deploy('v2-asset-manager-utils/MockAssetManager', { args: [tokens.get(0).address] }),
      await deploy('v2-asset-manager-utils/MockAssetManager', { args: [tokens.get(1).address] }),
      await deploy('v2-asset-manager-utils/MockAssetManager', { args: [tokens.get(2).address] }),
    ];

    pool = await deploy('MockRebalancedBasePool', {
      args: [
        vault.address,
        GeneralPool,
        'BPT',
        'BPT',
        tokens.addresses,
        assetManagers.map((assetManager) => assetManager.address),
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
      expect(await pool.getRelayer()).to.be.equal(relayer.address);
    });
  });

  const join = async () => {
    return vault.joinPool({
      poolAddress: pool.address,
      poolId: await pool.getPoolId(),
      recipient: user.address,
      currentBalances: Array(tokens.length).fill(fp(1000)),
      tokens: tokens.addresses,
      lastChangeBlock: 0,
      protocolFeePercentage: 0,
      data: '0x',
      from: user,
    });
  };

  describe('join', () => {
    context('when no asset manager requires a rebalance', () => {
      sharedBeforeEach('mock asset manager', async () => {
        await Promise.all(assetManagers.map((assetManager) => assetManager.mockShouldRebalance(false)));
      });

      context('when the relayer tells it has not called the pool', () => {
        sharedBeforeEach('mock relayer', async () => {
          await relayer.mockHasCalledPool(false);
        });

        it('does not revert', async () => {
          await expect(join()).not.to.be.reverted;
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

    context('when some asset managers require a rebalance', () => {
      sharedBeforeEach('mock asset manager', async () => {
        await assetManagers[1].mockShouldRebalance(true);
      });

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
  });

  describe('exit', () => {
    const exit = async () => {
      return vault.exitPool({
        poolAddress: pool.address,
        poolId: await pool.getPoolId(),
        recipient: user.address,
        currentBalances: Array(tokens.length).fill(fp(0)),
        tokens: tokens.addresses,
        lastChangeBlock: 0,
        protocolFeePercentage: 0,
        data: '0x',
        from: user,
      });
    };

    sharedBeforeEach('join', async () => {
      await relayer.mockHasCalledPool(true);
      await join();
    });

    context('when no asset manager requires a rebalance', () => {
      sharedBeforeEach('mock asset manager', async () => {
        await Promise.all(assetManagers.map((assetManager) => assetManager.mockShouldRebalance(false)));
      });

      context('when the relayer tells it has not called the pool', () => {
        sharedBeforeEach('mock relayer', async () => {
          await relayer.mockHasCalledPool(false);
        });

        it('does not revert', async () => {
          await exit();
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

    context('when some asset managers require a rebalance', () => {
      sharedBeforeEach('mock asset manager', async () => {
        await assetManagers[1].mockShouldRebalance(true);
      });

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
});
