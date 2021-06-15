import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import {
  encodeExitWeightedPool,
  encodeJoinWeightedPool,
} from '@balancer-labs/v2-helpers/src/models/pools/weighted/encoding';

describe.only('RebalancingRelayer', function () {
  let user: SignerWithAddress, admin: SignerWithAddress, tokens: TokenList, poolId: string;
  let vault: Contract, authorizer: Contract, relayer: Contract, pool: Contract, assetManager: Contract;

  before('setup signer', async () => {
    [, admin, user] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy relayer', async () => {
    authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, ZERO_ADDRESS, 0, 0] });
    relayer = await deploy('RebalancingRelayer', { args: [vault.address] });
  });

  sharedBeforeEach('deploy sample pool', async () => {
    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    assetManager = await deploy('MockAssetManager');
    pool = await deploy('v2-pool-utils/MockRelayedBasePool', {
      args: [
        vault.address,
        GeneralPool,
        'BPT',
        'BPT',
        tokens.addresses,
        Array(tokens.length).fill(assetManager.address),
        fp(0.1),
        0,
        0,
        relayer.address,
        ZERO_ADDRESS,
      ],
    });
    poolId = await pool.getPoolId();
  });

  describe('vault', () => {
    it('uses the given vault', async () => {
      expect(await relayer.vault()).to.be.equal(vault.address);
    });
  });

  describe('join', () => {
    let request: { assets: string[]; maxAmountsIn: BigNumberish[]; userData: string; fromInternalBalance: boolean };

    sharedBeforeEach('build join request', async () => {
      const amountsIn = Array(tokens.length).fill(fp(10));
      request = {
        assets: tokens.addresses,
        maxAmountsIn: amountsIn,
        userData: encodeJoinWeightedPool({ kind: 'Init', amountsIn }),
        fromInternalBalance: false,
      };
    });

    context('when going through the relayer', () => {
      context('when the relayer is allowed to join', () => {
        sharedBeforeEach('allow relayer', async () => {
          const action = await actionId(vault, 'joinPool');
          await authorizer.connect(admin).grantRole(action, relayer.address);
        });

        context('when the user did allow the relayer', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(user).setRelayerApproval(user.address, relayer.address, true);
          });

          it('joins the pool', async () => {
            const previousUserBalance = await pool.balanceOf(user.address);
            const previousRelayerBalance = await pool.balanceOf(relayer.address);

            await relayer.connect(user).joinPool(poolId, request);

            const currentUserBalance = await pool.balanceOf(user.address);
            expect(currentUserBalance.gt(previousUserBalance)).to.be.true;

            const currentRelayerBalance = await pool.balanceOf(relayer.address);
            expect(currentRelayerBalance).to.be.equal(previousRelayerBalance);
          });

          it('rebalances the pool', async () => {
            const receipt = await relayer.connect(user).joinPool(poolId, request);
            expectEvent.inIndirectReceipt(await receipt.wait(), assetManager.interface, 'Rebalanced', { poolId });
          });
        });

        context('when the user did not allow the relayer', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(user).setRelayerApproval(user.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(relayer.connect(user).joinPool(poolId, request)).to.be.revertedWith(
              'USER_DOESNT_ALLOW_RELAYER'
            );
          });
        });

        context('when the relayer is allowed to join', () => {
          sharedBeforeEach('allow relayer', async () => {
            const action = await actionId(vault, 'joinPool');
            await authorizer.connect(admin).revokeRole(action, relayer.address);
          });

          it('reverts', async () => {
            await expect(relayer.connect(user).joinPool(poolId, request)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });
    });

    context('when going through the vault', () => {
      it('reverts', async () => {
        await expect(vault.connect(user).joinPool(poolId, user.address, user.address, request)).to.be.revertedWith(
          'BASE_POOL_RELAYER_NOT_CALLED'
        );
      });
    });
  });

  describe('exit', () => {
    let joinRequest: { assets: string[]; maxAmountsIn: BigNumberish[]; userData: string; fromInternalBalance: boolean };
    let exitRequest: { assets: string[]; minAmountsOut: BigNumberish[]; userData: string; toInternalBalance: boolean };

    sharedBeforeEach('build exit request', async () => {
      const amountsIn = Array(tokens.length).fill(fp(10));

      joinRequest = {
        assets: tokens.addresses,
        maxAmountsIn: amountsIn,
        userData: encodeJoinWeightedPool({ kind: 'Init', amountsIn }),
        fromInternalBalance: false,
      };

      exitRequest = {
        assets: tokens.addresses,
        minAmountsOut: Array(amountsIn.length).fill(0),
        userData: encodeExitWeightedPool({
          kind: 'BPTInForExactTokensOut',
          maxBPTAmountIn: MAX_UINT256,
          amountsOut: amountsIn,
        }),
        toInternalBalance: false,
      };
    });

    context('when going through the relayer', () => {
      context('when the relayer is allowed to exit', () => {
        sharedBeforeEach('allow relayer', async () => {
          const action = await actionId(vault, 'exitPool');
          await authorizer.connect(admin).grantRole(action, relayer.address);
        });

        context('when the user did allow the relayer', () => {
          sharedBeforeEach('allow relayer', async () => {
            await vault.connect(user).setRelayerApproval(user.address, relayer.address, true);
          });

          sharedBeforeEach('join pool', async () => {
            const action = await actionId(vault, 'joinPool');
            await authorizer.connect(admin).grantRole(action, relayer.address);
            await relayer.connect(user).joinPool(poolId, joinRequest);
          });

          it('exits the pool', async () => {
            const previousUserBalance = await pool.balanceOf(user.address);
            const previousRelayerBalance = await pool.balanceOf(relayer.address);

            await relayer.connect(user).exitPool(poolId, exitRequest);

            const currentUserBalance = await pool.balanceOf(user.address);
            expect(currentUserBalance.lt(previousUserBalance)).to.be.true;

            const currentRelayerBalance = await pool.balanceOf(relayer.address);
            expect(currentRelayerBalance).to.be.equal(previousRelayerBalance);
          });

          it('rebalances the pool', async () => {
            const receipt = await relayer.connect(user).exitPool(poolId, exitRequest);
            expectEvent.inIndirectReceipt(await receipt.wait(), assetManager.interface, 'Rebalanced', { poolId });
          });
        });

        context('when the user did not allow the relayer', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(user).setRelayerApproval(user.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(relayer.connect(user).exitPool(poolId, exitRequest)).to.be.revertedWith(
              'USER_DOESNT_ALLOW_RELAYER'
            );
          });
        });

        context('when the relayer is allowed to exit', () => {
          sharedBeforeEach('allow relayer', async () => {
            const action = await actionId(vault, 'exitPool');
            await authorizer.connect(admin).revokeRole(action, relayer.address);
          });

          it('reverts', async () => {
            await expect(relayer.connect(user).exitPool(poolId, exitRequest)).to.be.revertedWith('SENDER_NOT_ALLOWED');
          });
        });
      });
    });

    context('when going through the vault', () => {
      it('reverts', async () => {
        await expect(vault.connect(user).exitPool(poolId, user.address, user.address, exitRequest)).to.be.revertedWith(
          'BASE_POOL_RELAYER_NOT_CALLED'
        );
      });
    });
  });
});
