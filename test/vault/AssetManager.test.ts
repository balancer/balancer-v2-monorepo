import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '../helpers/models/tokens/Token';
import TokenList from '../helpers/models/tokens/TokenList';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { encodeExit, encodeJoin } from '../helpers/mockPool';

import { bn } from '../../lib/helpers/numbers';
import { deploy } from '../../lib/helpers/deploy';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '../../lib/helpers/constants';
import { GeneralPool, MinimalSwapInfoPool, PoolSpecializationSetting, TwoTokenPool } from '../../lib/helpers/pools';
import * as expectEvent from '../helpers/expectEvent';
import { lastBlockNumber } from '../../lib/helpers/time';

const OP_KIND = { WITHDRAW: 0, DEPOSIT: 1, UPDATE: 2 };

describe.only('Vault - asset manager', function () {
  let tokens: TokenList, otherToken: Token, vault: Contract;
  let lp: SignerWithAddress,
    assetManager: SignerWithAddress,
    otherAssetManager: SignerWithAddress,
    other: SignerWithAddress;

  before('setup signers', async () => {
    [, lp, assetManager, otherAssetManager, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset managers', async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS, ZERO_ADDRESS, 0, 0] });
    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    otherToken = await Token.create('OTHER');
  });

  context('with general pool', () => {
    itManagesAssetsCorrectly(GeneralPool);
  });

  context('with minimal swap info pool', () => {
    itManagesAssetsCorrectly(MinimalSwapInfoPool);
  });

  context('with two token pool', () => {
    itManagesAssetsCorrectly(TwoTokenPool);
  });

  function itManagesAssetsCorrectly(specialization: PoolSpecializationSetting) {
    let poolId: string;
    const tokenInitialBalance = bn(200e18);

    sharedBeforeEach('deploy pool and add liquidity', async () => {
      const pool = await deploy('MockPool', { args: [vault.address, specialization] });
      poolId = await pool.getPoolId();

      await tokens.mint({ to: lp, amount: tokenInitialBalance });
      await tokens.approve({ to: vault, from: [lp, assetManager] });

      const assetManagers = [assetManager.address, otherAssetManager.address];

      await pool.registerTokens(tokens.addresses, assetManagers);

      await vault.connect(lp).joinPool(poolId, lp.address, other.address, {
        assets: tokens.addresses,
        maxAmountsIn: tokens.addresses.map(() => MAX_UINT256),
        fromInternalBalance: false,
        userData: encodeJoin(
          tokens.addresses.map(() => tokenInitialBalance),
          tokens.addresses.map(() => 0)
        ),
      });
    });

    describe('setting', () => {
      it('different managers can be set for different tokens', async () => {
        expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
        expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(
          otherAssetManager.address
        );
      });

      it('removes asset managers when deregistering', async () => {
        // First asset the managers are set
        expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
        expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(
          otherAssetManager.address
        );

        const [poolAddress] = await vault.getPool(poolId);
        const pool = await ethers.getContractAt('MockPool', poolAddress);

        const { tokens: poolTokens, balances } = await vault.getPoolTokens(poolId);

        // Balances must be zero to deregister, so we do a full exit
        await vault.connect(lp).exitPool(poolId, lp.address, lp.address, {
          assets: poolTokens,
          minAmountsOut: Array(poolTokens.length).fill(0),
          toInternalBalance: false,
          userData: encodeExit(balances, Array(poolTokens.length).fill(0)),
        });

        // Deregistering tokens should remove the asset managers
        await pool.deregisterTokens([tokens.DAI.address, tokens.MKR.address]);

        await tokens.asyncEach((token: Token) =>
          expect(vault.getPoolTokenInfo(poolId, token.address)).to.be.revertedWith('TOKEN_NOT_REGISTERED')
        );

        // Should also be able to re-register (just one in this case)
        await pool.registerTokens([tokens.DAI.address, tokens.MKR.address], [assetManager.address, ZERO_ADDRESS]);

        expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
        expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(ZERO_ADDRESS);
      });

      it('reverts when querying the asset manager of an unknown pool', async () => {
        const error = 'INVALID_POOL_ID';
        const token = tokens.DAI.address;
        await expect(vault.getPoolTokenInfo(ZERO_BYTES32, token)).to.be.revertedWith(error);
      });

      it('reverts when querying the asset manager of an unknown token', async () => {
        for (const token of [ZERO_ADDRESS, otherToken.address]) {
          const error = 'TOKEN_NOT_REGISTERED';
          await expect(vault.getPoolTokenInfo(poolId, token)).to.be.revertedWith(error);
        }
      });
    });

    describe('withdrawal', () => {
      const kind = OP_KIND.WITHDRAW;

      context('when the sender the manager', () => {
        context('when trying to withdraw less than the pool balance', () => {
          const amount = bn(10e18);

          it('transfers the requested token from the vault to the manager', async () => {
            const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];

            await expectBalanceChange(() => vault.connect(assetManager).managePoolBalance(ops), tokens, [
              { account: assetManager, changes: { DAI: amount } },
              { account: vault, changes: { DAI: amount.mul(-1) } },
            ]);
          });

          it('does not affect the balance of the pools', async () => {
            const [previousBalanceDAI, previousBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;

            const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
            await vault.connect(assetManager).managePoolBalance(ops);

            const [currentBalanceDAI, currentBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI);
            expect(currentBalanceMKR).to.equal(previousBalanceMKR);
          });

          it('does not update the block number', async () => {
            const previousBlockNumber = (await vault.getPoolTokens(poolId)).maxBlockNumber;

            const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
            await vault.connect(assetManager).managePoolBalance(ops);

            expect((await vault.getPoolTokens(poolId)).maxBlockNumber).to.equal(previousBlockNumber);
          });

          it('moves the balance from cash to managed', async () => {
            const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

            const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
            await vault.connect(assetManager).managePoolBalance(ops);

            const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash.sub(amount));
            expect(currentBalance.managed).to.equal(previousBalance.managed.add(amount));
            expect(currentBalance.blockNumber).to.equal(previousBalance.blockNumber);
          });

          it('emits an event', async () => {
            const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
            const receipt = await (await vault.connect(assetManager).managePoolBalance(ops)).wait();

            expectEvent.inReceipt(receipt, 'PoolBalanceManaged', {
              poolId,
              token: tokens.DAI.address,
              assetManager: assetManager.address,
              cashDelta: amount.mul(-1),
              managedDelta: amount,
            });
          });
        });

        context('when trying to withdraw more than the pool balance', () => {
          const amount = tokenInitialBalance.add(1);

          it('reverts', async () => {
            const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
            const withdraw = vault.connect(assetManager).managePoolBalance(ops);

            await expect(withdraw).to.be.revertedWith('SUB_OVERFLOW');
          });
        });

        context('when withdrawing a zero amount', () => {
          const amount = 0;

          it('does nothing', async () => {
            const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];

            await expectBalanceChange(() => vault.connect(assetManager).managePoolBalance(ops), tokens, {
              account: vault.address,
            });
          });
        });
      });

      context('when the sender is not the asset manager', () => {
        it('reverts', async () => {
          const ops = [{ kind, poolId, token: tokens.DAI.address, amount: 0 }];
          const withdraw = vault.connect(other).managePoolBalance(ops);

          await expect(withdraw).to.be.revertedWith('SENDER_NOT_ASSET_MANAGER');
        });
      });
    });

    describe('deposit', () => {
      const kind = OP_KIND.DEPOSIT;

      context('when the sender is the asset manager', () => {
        let sender: SignerWithAddress;

        beforeEach(() => {
          sender = assetManager;
        });

        context('with managed amount', () => {
          const managedAmount = bn(10e18);

          sharedBeforeEach('withdraw', async () => {
            const ops = [{ kind: OP_KIND.WITHDRAW, poolId, token: tokens.DAI.address, amount: managedAmount }];
            await vault.connect(sender).managePoolBalance(ops);
          });

          context('when depositing zero', () => {
            itDepositsManagedBalance(bn(0));
          });

          context('when depositing less than the managed balance', () => {
            itDepositsManagedBalance(managedAmount.div(2).add(1));
          });

          context('when depositing all the managed balance', () => {
            itDepositsManagedBalance(managedAmount);
          });

          context('when depositing more than the managed balance', () => {
            const amount = managedAmount.add(1);

            it('reverts', async () => {
              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
              await expect(vault.connect(sender).managePoolBalance(ops)).to.be.revertedWith('SUB_OVERFLOW');
            });
          });

          function itDepositsManagedBalance(amount: BigNumber) {
            it('transfers the requested token from the manager to the vault', async () => {
              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];

              await expectBalanceChange(() => vault.connect(sender).managePoolBalance(ops), tokens, [
                { account: assetManager, changes: { DAI: amount.mul(-1) } },
                { account: vault, changes: { DAI: amount } },
              ]);
            });

            it('does not affect the balance of the pools', async () => {
              const [previousBalanceDAI, previousBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;

              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
              await vault.connect(sender).managePoolBalance(ops);

              const [currentBalanceDAI, currentBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;
              expect(currentBalanceDAI).to.equal(previousBalanceDAI);
              expect(currentBalanceMKR).to.equal(previousBalanceMKR);
            });

            it('does not update the block number', async () => {
              const previousBlockNumber = (await vault.getPoolTokens(poolId)).maxBlockNumber;

              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
              await vault.connect(sender).managePoolBalance(ops);

              expect((await vault.getPoolTokens(poolId)).maxBlockNumber).to.equal(previousBlockNumber);
            });

            it('moves the balance from managed to cash', async () => {
              const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
              await vault.connect(sender).managePoolBalance(ops);

              const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
              expect(currentBalance.cash).to.equal(previousBalance.cash.add(amount));
              expect(currentBalance.managed).to.equal(previousBalance.managed.sub(amount));
              expect(currentBalance.blockNumber).to.equal(previousBalance.blockNumber);
            });

            it('emits an event', async () => {
              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
              const receipt = await (await vault.connect(sender).managePoolBalance(ops)).wait();

              expectEvent.inReceipt(receipt, 'PoolBalanceManaged', {
                poolId,
                token: tokens.DAI.address,
                assetManager: assetManager.address,
                cashDelta: amount,
                managedDelta: amount.mul(-1),
              });
            });
          }
        });
      });

      context('when the sender is not the asset manager', () => {
        let sender: SignerWithAddress;

        beforeEach(() => {
          sender = other;
        });

        it('reverts', async () => {
          const ops = [{ kind, poolId, token: tokens.DAI.address, amount: bn(0) }];
          await expect(vault.connect(sender).managePoolBalance(ops)).to.be.revertedWith('SENDER_NOT_ASSET_MANAGER');
        });
      });
    });

    describe('update', () => {
      const kind = OP_KIND.UPDATE;

      context('when the sender is the asset manager', () => {
        let sender: SignerWithAddress;

        beforeEach(() => {
          sender = assetManager;
        });

        context('with managed amount', () => {
          const managedAmount = bn(10e18);

          sharedBeforeEach('withdraw', async () => {
            const ops = [{ kind: OP_KIND.WITHDRAW, poolId, token: tokens.DAI.address, amount: managedAmount }];
            await vault.connect(sender).managePoolBalance(ops);
          });

          context('with gains', () => {
            itUpdatesManagedBalance(bn(1));
          });

          context('with losses', () => {
            itUpdatesManagedBalance(bn(-1));
          });

          context('with no change', () => {
            itUpdatesManagedBalance(bn(0));
          });

          function itUpdatesManagedBalance(delta: BigNumber) {
            const amount = managedAmount.add(delta);

            it('does not transfer tokens', async () => {
              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];

              await expectBalanceChange(() => vault.connect(sender).managePoolBalance(ops), tokens, [
                { account: assetManager },
                { account: vault },
              ]);
            });

            it('updates the balance of the pool', async () => {
              const [previousBalanceDAI, previousBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;

              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
              await vault.connect(sender).managePoolBalance(ops);

              const [currentBalanceDAI, currentBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;
              expect(currentBalanceDAI).to.equal(previousBalanceDAI.add(delta));
              expect(currentBalanceMKR).to.equal(previousBalanceMKR);
            });

            if (specialization == TwoTokenPool) {
              it('updates both block numbers when updating token A', async () => {
                const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                await vault.connect(sender).managePoolBalance(ops);

                const blockNumber = await lastBlockNumber();

                expect((await vault.getPoolTokens(poolId)).maxBlockNumber).to.equal(blockNumber);
                expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).blockNumber).to.equal(blockNumber);
                expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).blockNumber).to.equal(blockNumber);
              });

              it('updates both block numbers when updating token B', async () => {
                const ops = [{ kind, poolId, token: tokens.MKR.address, amount }];
                await vault.connect(otherAssetManager).managePoolBalance(ops);

                const blockNumber = await lastBlockNumber();

                expect((await vault.getPoolTokens(poolId)).maxBlockNumber).to.equal(blockNumber);
                expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).blockNumber).to.equal(blockNumber);
                expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).blockNumber).to.equal(blockNumber);
              });
            } else {
              it('updates the block number of the updated token only', async () => {
                const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                await vault.connect(sender).managePoolBalance(ops);

                const blockNumber = await lastBlockNumber();

                expect((await vault.getPoolTokens(poolId)).maxBlockNumber).to.equal(blockNumber);
                expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).blockNumber).to.equal(blockNumber);
                expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).blockNumber).to.be.lt(blockNumber);
              });
            }

            it('sets the managed balance', async () => {
              const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
              await vault.connect(sender).managePoolBalance(ops);

              const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
              expect(currentBalance.cash).to.equal(previousBalance.cash);
              expect(currentBalance.managed).to.equal(amount);

              expect(currentBalance.blockNumber).to.equal(await lastBlockNumber());
            });

            it('emits an event', async () => {
              const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

              const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
              const receipt = await (await vault.connect(sender).managePoolBalance(ops)).wait();

              expectEvent.inReceipt(receipt, 'PoolBalanceManaged', {
                poolId,
                token: tokens.DAI.address,
                assetManager: assetManager.address,
                cashDelta: 0,
                managedDelta: amount.sub(previousBalance.managed),
              });
            });
          }
        });
      });

      context('when the sender is not the asset manager', () => {
        let sender: SignerWithAddress;

        beforeEach(() => {
          sender = other;
        });

        it('reverts', async () => {
          const ops = [{ kind, poolId, token: tokens.DAI.address, amount: bn(0) }];
          await expect(vault.connect(sender).managePoolBalance(ops)).to.be.revertedWith('SENDER_NOT_ASSET_MANAGER');
        });
      });
    });
  }
});
