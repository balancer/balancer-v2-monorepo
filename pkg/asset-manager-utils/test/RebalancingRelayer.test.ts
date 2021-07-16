import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import { ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { encodeInvestmentConfig } from './helpers/rebalance';

describe('RebalancingRelayer', function () {
  let poolId: string, tokens: TokenList;
  let sender: SignerWithAddress, recipient: SignerWithAddress, admin: SignerWithAddress;
  let vault: Contract, authorizer: Contract, relayer: Contract, pool: Contract, assetManagers: Contract[];

  // An array of token amounts which will be added/removed to pool's balance on joins/exits
  let tokenIncrements: BigNumber[];

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
    tokenIncrements = Array(tokens.length).fill(fp(1));
  });

  sharedBeforeEach('deploy sample pool', async () => {
    assetManagers = [
      await deploy('MockRewardsAssetManager', { args: [vault.address, ZERO_BYTES32, tokens.first.address] }),
      await deploy('MockRewardsAssetManager', { args: [vault.address, ZERO_BYTES32, tokens.second.address] }),
    ];
    pool = await deploy('v2-pool-utils/MockRelayedBasePool', {
      args: [
        vault.address,
        PoolSpecialization.GeneralPool,
        'BPT',
        'BPT',
        tokens.addresses,
        assetManagers.map((a) => a.address),
        fp(0.1),
        0,
        0,
        relayer.address,
        admin.address,
      ],
    });

    poolId = await pool.getPoolId();
    await Promise.all(assetManagers.map((assetManager) => assetManager.initialize(poolId)));
  });

  describe('vault', () => {
    it('uses the given vault', async () => {
      expect(await relayer.vault()).to.be.equal(vault.address);
    });
  });

  describe('join', () => {
    let request: { assets: string[]; maxAmountsIn: BigNumberish[]; userData: string; fromInternalBalance: boolean };

    sharedBeforeEach('build join request', async () => {
      request = {
        assets: tokens.addresses,
        maxAmountsIn: tokenIncrements,
        userData: '0x',
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

          it('updates the vault with any unrealized gains', async () => {
            // Simulate a return by minting new tokens to the asset manager
            const unrealizedReturn = 1000;
            await tokens.first.mint(assetManagers[0], unrealizedReturn);

            // Add this return to the balances which the Vault knows about
            const { balances } = await vault.getPoolTokens(poolId);
            const expectedBalances = [balances[0].add(unrealizedReturn), ...balances.slice(1)];

            const receipt = await relayer.connect(sender).joinPool(poolId, recipient.address, request);

            expectEvent.inIndirectReceipt(await receipt.wait(), pool.interface, 'Join', {
              poolId,
              balances: expectedBalances,
            });
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

            expectEvent.inIndirectReceipt(await receipt.wait(), assetManagers[0].interface, 'Rebalance', {
              poolId,
            });

            expectEvent.inIndirectReceipt(await receipt.wait(), assetManagers[1].interface, 'Rebalance', {
              poolId,
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
      joinRequest = {
        assets: tokens.addresses,
        maxAmountsIn: tokenIncrements,
        userData: '0x',
        fromInternalBalance: false,
      };

      exitRequest = {
        assets: tokens.addresses,
        minAmountsOut: tokenIncrements,
        userData: '0x',
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
            // We join twice here so that exiting doesn't return the pool to a zero-balance state
            await relayer.connect(sender).joinPool(poolId, sender.address, joinRequest);
            await relayer.connect(sender).joinPool(poolId, sender.address, joinRequest);
          });

          function itExitsCorrectly() {
            it('updates the vault with any unrealized gains', async () => {
              // Simulate a return by minting new tokens to the asset manager
              const unrealizedReturn = 1000;
              await tokens.first.mint(assetManagers[0], unrealizedReturn);

              // Add this return to the balances which the Vault knows about
              const { balances } = await vault.getPoolTokens(poolId);
              const expectedBalances = [balances[0].add(unrealizedReturn), ...balances.slice(1)];

              const receipt = await relayer
                .connect(sender)
                .exitPool(poolId, recipient.address, exitRequest, tokenIncrements);

              expectEvent.inIndirectReceipt(await receipt.wait(), pool.interface, 'Exit', {
                poolId,
                balances: expectedBalances,
              });
            });

            it('exits the pool', async () => {
              const previousSenderBalance = await pool.balanceOf(sender.address);
              const previousRelayerBalance = await pool.balanceOf(relayer.address);

              const receipt = await relayer
                .connect(sender)
                .exitPool(poolId, recipient.address, exitRequest, tokenIncrements);

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
              const receipt = await relayer
                .connect(sender)
                .exitPool(poolId, recipient.address, exitRequest, tokenIncrements);

              expectEvent.inIndirectReceipt(await receipt.wait(), assetManagers[0].interface, 'Rebalance', {
                poolId,
              });

              expectEvent.inIndirectReceipt(await receipt.wait(), assetManagers[1].interface, 'Rebalance', {
                poolId,
              });
            });
          }

          context('when pool has enough cash to process exit', () => {
            itExitsCorrectly();
          });

          context('when pool does not have enough cash to process exit', () => {
            sharedBeforeEach('invest funds', async () => {
              // Config invests 100% of the pool's funds to ensure lack of cash
              const investmentConfig = {
                targetPercentage: fp(1),
                upperCriticalPercentage: fp(1),
                lowerCriticalPercentage: fp(0),
              };
              await pool
                .connect(admin)
                .setAssetManagerPoolConfig(tokens.first.address, encodeInvestmentConfig(investmentConfig));

              await assetManagers[0].rebalance(poolId, true);

              // Check that the pool has less cash than necessary for a withdrawal
              const { cash } = await vault.getPoolTokenInfo(poolId, tokens.first.address);
              expect(cash).to.be.lt(tokenIncrements[0]);
            });

            itExitsCorrectly();
          });
        });

        context('when the user did not allow the relayer', () => {
          sharedBeforeEach('disallow relayer', async () => {
            await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, false);
          });

          it('reverts', async () => {
            await expect(
              relayer.connect(sender).exitPool(
                poolId,
                recipient.address,
                exitRequest,
                tokens.map(() => 0)
              )
            ).to.be.revertedWith('USER_DOESNT_ALLOW_RELAYER');
          });
        });

        context('when the relayer is not allowed to exit', () => {
          sharedBeforeEach('revoke relayer', async () => {
            const action = await actionId(vault, 'exitPool');
            await authorizer.connect(admin).revokeRole(action, relayer.address);
          });

          it('reverts', async () => {
            await expect(
              relayer.connect(sender).exitPool(
                poolId,
                recipient.address,
                exitRequest,
                tokens.map(() => 0)
              )
            ).to.be.revertedWith('SENDER_NOT_ALLOWED');
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
