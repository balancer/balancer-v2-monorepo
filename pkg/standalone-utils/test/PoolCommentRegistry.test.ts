import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import WeightedPool from '@balancer-labs/v2-helpers/src/models/pools/weighted/WeightedPool';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';

describe('PoolCommentRegistry', function () {
  let registry: Contract, vault: Vault, pool: WeightedPool, lp: SignerWithAddress, other: SignerWithAddress;

  const comment = 'This is a comment';

  before('setup signers', async () => {
    [, lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy and initialize pool', async () => {
    vault = await Vault.create();

    const tokens = await TokenList.create(2, { sorted: true });
    pool = await WeightedPool.create({ vault, tokens, swapFeePercentage: fp(0.000001) });

    await tokens.mint({ to: lp, amount: fp(100) });
    await tokens.approve({ from: lp, to: vault.address, amount: fp(100) });
    await pool.init({ initialBalances: new Array(2).fill(fp(100)), from: lp });
  });

  sharedBeforeEach('deploy registry', async () => {
    registry = await deploy('PoolCommentRegistry', { args: [vault.address] });
  });

  it('returns the vault address', async () => {
    expect(await registry.getVault()).to.equal(vault.address);
  });

  describe('addPoolComment', () => {
    context('with unregistered pool', () => {
      context('with pool address', () => {
        it('reverts', async () => {
          await expect(registry.addPoolComment(other.address, comment)).to.be.reverted; // The getPoolId() call reverts
        });
      });

      context('with pool id', () => {
        it('reverts', async () => {
          await expect(registry.addPoolIdComment(ZERO_BYTES32, comment)).to.be.revertedWith('INVALID_POOL_ID');
        });
      });
    });

    context('with registered pool', () => {
      context('with pool address', () => {
        it('emits an event', async () => {
          const receipt = await (await registry.connect(other).addPoolComment(pool.address, comment)).wait();
          expectEvent.inReceipt(receipt, 'PoolComment', { sender: other.address, poolId: pool.poolId, comment });
        });
      });

      context('with pool id', () => {
        it('emits an event', async () => {
          const receipt = await (await registry.connect(other).addPoolIdComment(pool.poolId, comment)).wait();
          expectEvent.inReceipt(receipt, 'PoolComment', { sender: other.address, poolId: pool.poolId, comment });
        });
      });
    });
  });
});
