import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
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

describe('RebalancingRelayer', function () {
  let poolId: string, tokens: TokenList;
  let sender: SignerWithAddress, recipient: SignerWithAddress, admin: SignerWithAddress;
  let vault: Contract, authorizer: Contract, relayer: Contract, pool: Contract, assetManagers: Contract[];

  before('setup signer', async () => {
    [, admin, sender, recipient] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy relayer', async () => {
    const DAI = await Token.create('DAI');
    const WETH = await Token.create('WETH');
    tokens = new TokenList([DAI, WETH].sort());

    authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, tokens.WETH.address, 0, 0] });
    relayer = await deploy('RebalancingRelayer', { args: [vault.address] });

    await tokens.mint({ to: sender, amount: fp(100) });
    await tokens.approve({ to: vault, amount: fp(100), from: sender });
  });

  sharedBeforeEach('deploy sample pool', async () => {
    assetManagers = [
      await deploy('MockAssetManager', { args: [tokens.first.address] }),
      await deploy('MockAssetManager', { args: [tokens.second.address] }),
    ];
    pool = await deploy('v2-pool-utils/MockRelayedBasePool', {
      args: [
        vault.address,
        GeneralPool,
        'BPT',
        'BPT',
        tokens.addresses,
        assetManagers.map((a) => a.address),
        fp(0.1),
        0,
        0,
        relayer.address,
        ZERO_ADDRESS,
      ],
    });
    poolId = await pool.getPoolId();
  });

  describe('getVault', () => {
    it('uses the given vault', async () => {
      expect(await relayer.getVault()).to.be.equal(vault.address);
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          it('joins the pool', async () => {
            const previousSenderBalance = await pool.balanceOf(sender.address);
            const previousRecipientBalance = await pool.balanceOf(recipient.address);
            const previousRelayerBalance = await pool.balanceOf(relayer.address);

            const receipt = await relayer.connect(sender).joinPool(poolId, recipient.address, request);

            expectEvent.inIndirectReceipt(await receipt.wait(), pool.interface, 'Join', {
              poolId,
              sender: sender.address,
              recipient: recipient.address,
              userData: request.userData,
            });

            const currentSenderBalance = await pool.balanceOf(sender.address);
            expect(currentSenderBalance).to.be.equal(previousSenderBalance);

            const currentRecipientBalance = await pool.balanceOf(recipient.address);
            expect(currentRecipientBalance.gt(previousRecipientBalance)).to.be.true;

            const currentRelayerBalance = await pool.balanceOf(relayer.address);
            expect(currentRelayerBalance).to.be.equal(previousRelayerBalance);
          });

          it('rebalances the pool', async () => {
            const receipt = await relayer.connect(sender).joinPool(poolId, recipient.address, request);

            expectEvent.inIndirectReceipt(await receipt.wait(), assetManagers[0].interface, 'Rebalanced', {
              poolId,
              assetManager: assetManagers[0].address,
              token: tokens.first.address,
              force: false,
            });

            expectEvent.inIndirectReceipt(await receipt.wait(), assetManagers[1].interface, 'Rebalanced', {
              poolId,
              assetManager: assetManagers[1].address,
              token: tokens.second.address,
              force: false,
            });
          });

          it('returns any extra value to the sender', async () => {
            const previousVaultBalance = await tokens.WETH.balanceOf(vault.address);
            const previousSenderBalance = await ethers.provider.getBalance(sender.address);
            const previousRelayerBalance = await ethers.provider.getBalance(relayer.address);

            // Overwrite assets addresses to use ETH instead of WETH
            request.assets = tokens.map((token) => (token === tokens.WETH ? ZERO_ADDRESS : token.address));
            const gasPrice = 1;
            const receipt = await relayer
              .connect(sender)
              .joinPool(poolId, recipient.address, request, { value: fp(10), gasPrice });

            const ethUsed = (await receipt.wait()).gasUsed.mul(gasPrice);
            const currentSenderBalance = await ethers.provider.getBalance(sender.address);
            const expectedTransferredBalance = previousSenderBalance.sub(currentSenderBalance).sub(ethUsed);

            const currentVaultBalance = await tokens.WETH.balanceOf(vault.address);
            expect(currentVaultBalance).to.be.equal(previousVaultBalance.add(expectedTransferredBalance));

            const currentRelayerBalance = await ethers.provider.getBalance(relayer.address);
            expect(currentRelayerBalance).to.be.equal(previousRelayerBalance);
          });
        });

        context('when the user did not allow the relayer', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(relayer.connect(sender).joinPool(poolId, recipient.address, request)).to.be.revertedWith(
              'USER_DOESNT_ALLOW_RELAYER'
            );
          });
        });

        context('when the relayer is not allowed to join', () => {
          sharedBeforeEach('revoke relayer', async () => {
            const action = await actionId(vault, 'joinPool');
            await authorizer.connect(admin).revokeRole(action, relayer.address);
          });

          it('reverts', async () => {
            await expect(relayer.connect(sender).joinPool(poolId, recipient.address, request)).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        });
      });
    });

    context('when going through the vault', () => {
      it('reverts', async () => {
        await expect(
          vault.connect(sender).joinPool(poolId, sender.address, recipient.address, request)
        ).to.be.revertedWith('BASE_POOL_RELAYER_NOT_CALLED');
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
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
          });

          sharedBeforeEach('join pool', async () => {
            const action = await actionId(vault, 'joinPool');
            await authorizer.connect(admin).grantRole(action, relayer.address);
            await relayer.connect(sender).joinPool(poolId, sender.address, joinRequest);
          });

          it('exits the pool', async () => {
            const previousSenderBalance = await pool.balanceOf(sender.address);
            const previousRelayerBalance = await pool.balanceOf(relayer.address);

            const receipt = await relayer.connect(sender).exitPool(poolId, recipient.address, exitRequest);

            expectEvent.inIndirectReceipt(await receipt.wait(), pool.interface, 'Exit', {
              poolId,
              sender: sender.address,
              recipient: recipient.address,
              userData: exitRequest.userData,
            });

            const currentSenderBalance = await pool.balanceOf(sender.address);
            expect(currentSenderBalance.lt(previousSenderBalance)).to.be.true;

            const currentRelayerBalance = await pool.balanceOf(relayer.address);
            expect(currentRelayerBalance).to.be.equal(previousRelayerBalance);
          });

          it('rebalances the pool', async () => {
            const receipt = await relayer.connect(sender).exitPool(poolId, recipient.address, exitRequest);

            expectEvent.inIndirectReceipt(await receipt.wait(), assetManagers[0].interface, 'Rebalanced', {
              poolId,
              token: tokens.first.address,
            });

            expectEvent.inIndirectReceipt(await receipt.wait(), assetManagers[1].interface, 'Rebalanced', {
              poolId,
              token: tokens.second.address,
            });
          });
        });

        context('when the user did not allow the relayer', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(relayer.connect(sender).exitPool(poolId, recipient.address, exitRequest)).to.be.revertedWith(
              'USER_DOESNT_ALLOW_RELAYER'
            );
          });
        });

        context('when the relayer is not allowed to exit', () => {
          sharedBeforeEach('revoke relayer', async () => {
            const action = await actionId(vault, 'exitPool');
            await authorizer.connect(admin).revokeRole(action, relayer.address);
          });

          it('reverts', async () => {
            await expect(relayer.connect(sender).exitPool(poolId, recipient.address, exitRequest)).to.be.revertedWith(
              'SENDER_NOT_ALLOWED'
            );
          });
        });
      });
    });

    context('when going through the vault', () => {
      it('reverts', async () => {
        await expect(
          vault.connect(sender).exitPool(poolId, sender.address, sender.address, exitRequest)
        ).to.be.revertedWith('BASE_POOL_RELAYER_NOT_CALLED');
      });
    });
  });
});
