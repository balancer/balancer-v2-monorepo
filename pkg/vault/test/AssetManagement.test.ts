import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import { encodeExit, encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';

import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { lastBlockNumber, MONTH } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { PoolSpecialization } from '../../balancer-js/dist';

const OP_KIND = { WITHDRAW: 0, DEPOSIT: 1, UPDATE: 2 };

describe('Asset Management', function () {
  let authorizer: Contract, vault: Contract;
  let admin: SignerWithAddress,
    lp: SignerWithAddress,
    assetManager: SignerWithAddress,
    otherAssetManager: SignerWithAddress,
    other: SignerWithAddress;

  before('setup signers', async () => {
    [, admin, lp, assetManager, otherAssetManager, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, ZERO_ADDRESS, MONTH, MONTH] });
  });

  context('with general pool', () => {
    itManagesAssetsCorrectly(PoolSpecialization.GeneralPool);
  });

  context('with minimal swap info pool', () => {
    itManagesAssetsCorrectly(PoolSpecialization.MinimalSwapInfoPool);
  });

  context('with two token pool', () => {
    itManagesAssetsCorrectly(PoolSpecialization.TwoTokenPool);
  });

  function itManagesAssetsCorrectly(specialization: PoolSpecialization) {
    let tokens: TokenList;
    const tokenNumber = specialization == PoolSpecialization.TwoTokenPool ? 2 : 4;

    sharedBeforeEach('deploy tokens', async () => {
      tokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'].slice(0, tokenNumber), { sorted: true });
    });

    context('with unregistered pool', () => {
      const poolId = '0x1234123412341234123412341234123412341234123412341234123412341234';

      describe('withdraw', () => {
        const kind = OP_KIND.WITHDRAW;

        it('reverts', async () => {
          await expect(
            vault.connect(other).managePoolBalance([{ kind, poolId, token: ZERO_ADDRESS, amount: 0 }])
          ).to.be.revertedWith('INVALID_POOL_ID');
        });
      });

      describe('deposit', () => {
        const kind = OP_KIND.DEPOSIT;

        it('reverts', async () => {
          await expect(
            vault.connect(other).managePoolBalance([{ kind, poolId, token: ZERO_ADDRESS, amount: 0 }])
          ).to.be.revertedWith('INVALID_POOL_ID');
        });
      });

      describe('update', () => {
        const kind = OP_KIND.UPDATE;

        it('reverts', async () => {
          await expect(
            vault.connect(other).managePoolBalance([{ kind, poolId, token: ZERO_ADDRESS, amount: 0 }])
          ).to.be.revertedWith('INVALID_POOL_ID');
        });
      });
    });

    context('with registered pool', () => {
      let poolId: string;
      let pool: Contract;

      sharedBeforeEach('deploy pool', async () => {
        pool = await deploy('MockPool', { args: [vault.address, specialization] });
        poolId = await pool.getPoolId();
      });

      context('with unregistered token', () => {
        let token: string;

        beforeEach(() => {
          token = tokens.DAI.address;
        });

        describe('withdraw', () => {
          const kind = OP_KIND.WITHDRAW;

          it('reverts', async () => {
            await expect(
              vault.connect(other).managePoolBalance([{ kind, poolId, token, amount: 0 }])
            ).to.be.revertedWith('TOKEN_NOT_REGISTERED');
          });
        });

        describe('deposit', () => {
          const kind = OP_KIND.DEPOSIT;

          it('reverts', async () => {
            await expect(
              vault.connect(other).managePoolBalance([{ kind, poolId, token, amount: 0 }])
            ).to.be.revertedWith('TOKEN_NOT_REGISTERED');
          });
        });

        describe('update', () => {
          const kind = OP_KIND.UPDATE;

          it('reverts', async () => {
            await expect(
              vault.connect(other).managePoolBalance([{ kind, poolId, token, amount: 0 }])
            ).to.be.revertedWith('TOKEN_NOT_REGISTERED');
          });
        });
      });

      context('with registered token', () => {
        const tokenInitialBalance = bn(200e18);

        sharedBeforeEach('register tokens and add liquidity', async () => {
          await tokens.mint({ to: lp, amount: tokenInitialBalance.mul(5) });
          await tokens.approve({ to: vault, from: [lp, assetManager] });

          // Only manage the first token (DAI)
          const assetManagers = tokens.addresses.map(() => otherAssetManager.address);
          assetManagers[0] = assetManager.address;

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
            expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(
              assetManager.address
            );
            expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(
              otherAssetManager.address
            );
          });

          it('removes asset managers when deregistering', async () => {
            // First asset the managers are set
            expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(
              assetManager.address
            );
            expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(
              otherAssetManager.address
            );

            const [poolAddress] = await vault.getPool(poolId);
            const pool = await deployedAt('MockPool', poolAddress);

            const { tokens: poolTokens, balances } = await vault.getPoolTokens(poolId);

            // Balances must be zero to deregister, so we do a full exit
            await vault.connect(lp).exitPool(poolId, lp.address, lp.address, {
              assets: poolTokens,
              minAmountsOut: Array(poolTokens.length).fill(0),
              toInternalBalance: false,
              userData: encodeExit(balances, Array(poolTokens.length).fill(0)),
            });

            // Deregistering tokens should remove the asset managers
            await pool.deregisterTokens(tokens.addresses);

            await tokens.asyncEach((token: Token) =>
              expect(vault.getPoolTokenInfo(poolId, token.address)).to.be.revertedWith('TOKEN_NOT_REGISTERED')
            );

            // Should also be able to re-register (just one in this case)
            await pool.registerTokens([tokens.DAI.address, tokens.MKR.address], [assetManager.address, ZERO_ADDRESS]);

            expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(
              assetManager.address
            );
            expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(ZERO_ADDRESS);
          });

          it('reverts when querying the asset manager of an unknown pool', async () => {
            const error = 'INVALID_POOL_ID';
            const token = tokens.DAI.address;
            await expect(vault.getPoolTokenInfo(ZERO_BYTES32, token)).to.be.revertedWith(error);
          });

          it('reverts when querying the asset manager of an unregistered token', async () => {
            await expect(vault.getPoolTokenInfo(poolId, ZERO_ADDRESS)).to.be.revertedWith('TOKEN_NOT_REGISTERED');
          });
        });

        describe('withdraw', () => {
          const kind = OP_KIND.WITHDRAW;

          context('when the sender is the asset manager', () => {
            let sender: SignerWithAddress;

            beforeEach(() => {
              sender = assetManager;
            });

            context('when unpaused', () => {
              context('when withdrawing zero', () => {
                itWithdrawsPoolBalance(bn(0));
              });

              context('when withdrawing less than the pool balance', () => {
                itWithdrawsPoolBalance(tokenInitialBalance.sub(1));
              });

              context('when withdrawing all the pool balance', () => {
                itWithdrawsPoolBalance(tokenInitialBalance);
              });

              context('when withdrawing more than the pool balance', () => {
                const amount = tokenInitialBalance.add(1);

                it('reverts', async () => {
                  const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                  const withdraw = vault.connect(assetManager).managePoolBalance(ops);

                  await expect(withdraw).to.be.revertedWith('SUB_OVERFLOW');
                });
              });

              function itWithdrawsPoolBalance(amount: BigNumber) {
                it('transfers the requested token from the vault to the manager', async () => {
                  const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];

                  await expectBalanceChange(() => vault.connect(sender).managePoolBalance(ops), tokens, [
                    { account: assetManager, changes: { DAI: amount } },
                    { account: vault, changes: { DAI: amount.mul(-1) } },
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

                it('does not update the last change block', async () => {
                  const previousLastChangeBlock = (await vault.getPoolTokens(poolId)).lastChangeBlock;

                  const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                  await vault.connect(sender).managePoolBalance(ops);

                  expect((await vault.getPoolTokens(poolId)).lastChangeBlock).to.equal(previousLastChangeBlock);
                });

                it('moves the balance from cash to managed', async () => {
                  const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

                  const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                  await vault.connect(sender).managePoolBalance(ops);

                  const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
                  expect(currentBalance.cash).to.equal(previousBalance.cash.sub(amount));
                  expect(currentBalance.managed).to.equal(previousBalance.managed.add(amount));
                  expect(currentBalance.lastChangeBlock).to.equal(previousBalance.lastChangeBlock);
                });

                it('emits an event', async () => {
                  const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                  const receipt = await (await vault.connect(sender).managePoolBalance(ops)).wait();

                  expectEvent.inReceipt(receipt, 'PoolBalanceManaged', {
                    poolId,
                    token: tokens.DAI.address,
                    assetManager: assetManager.address,
                    cashDelta: amount.mul(-1),
                    managedDelta: amount,
                  });
                });
              }
            });

            context('when paused', () => {
              sharedBeforeEach('pause', async () => {
                const action = await actionId(vault, 'setPaused');
                await authorizer.connect(admin).grantRole(action, admin.address);
                await vault.connect(admin).setPaused(true);
              });

              it('reverts', async () => {
                const ops = [{ kind, poolId, token: tokens.DAI.address, amount: bn(0) }];
                await expect(vault.connect(sender).managePoolBalance(ops)).to.be.revertedWith('PAUSED');
              });
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

              context('when unpaused', () => {
                context('when depositing zero', () => {
                  itDepositsManagedBalance(bn(0));
                });

                context('when depositing less than the managed balance', () => {
                  itDepositsManagedBalance(managedAmount.sub(1));
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

                  it('does not update the last change block', async () => {
                    const previousLastChangeBlock = (await vault.getPoolTokens(poolId)).lastChangeBlock;

                    const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                    await vault.connect(sender).managePoolBalance(ops);

                    expect((await vault.getPoolTokens(poolId)).lastChangeBlock).to.equal(previousLastChangeBlock);
                  });

                  it('moves the balance from managed to cash', async () => {
                    const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

                    const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                    await vault.connect(sender).managePoolBalance(ops);

                    const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
                    expect(currentBalance.cash).to.equal(previousBalance.cash.add(amount));
                    expect(currentBalance.managed).to.equal(previousBalance.managed.sub(amount));
                    expect(currentBalance.lastChangeBlock).to.equal(previousBalance.lastChangeBlock);
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

              context('when paused', () => {
                sharedBeforeEach('pause', async () => {
                  const action = await actionId(vault, 'setPaused');
                  await authorizer.connect(admin).grantRole(action, admin.address);
                  await vault.connect(admin).setPaused(true);
                });

                it('reverts', async () => {
                  const ops = [{ kind, poolId, token: tokens.DAI.address, amount: bn(0) }];
                  await expect(vault.connect(sender).managePoolBalance(ops)).to.be.revertedWith('PAUSED');
                });
              });
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

              context('when unpaused', () => {
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

                  if (specialization == PoolSpecialization.TwoTokenPool) {
                    it('updates both last change blocks when updating token A', async () => {
                      const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                      await vault.connect(sender).managePoolBalance(ops);

                      const blockNumber = await lastBlockNumber();

                      expect((await vault.getPoolTokens(poolId)).lastChangeBlock).to.equal(blockNumber);
                      expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).lastChangeBlock).to.equal(
                        blockNumber
                      );
                      expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).lastChangeBlock).to.equal(
                        blockNumber
                      );
                    });

                    it('updates both last change blocks when updating token B', async () => {
                      const ops = [{ kind, poolId, token: tokens.MKR.address, amount }];
                      await vault.connect(otherAssetManager).managePoolBalance(ops);

                      const blockNumber = await lastBlockNumber();

                      expect((await vault.getPoolTokens(poolId)).lastChangeBlock).to.equal(blockNumber);
                      expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).lastChangeBlock).to.equal(
                        blockNumber
                      );
                      expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).lastChangeBlock).to.equal(
                        blockNumber
                      );
                    });
                  } else {
                    it('updates the last change block of the updated token only', async () => {
                      const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                      await vault.connect(sender).managePoolBalance(ops);

                      const blockNumber = await lastBlockNumber();

                      expect((await vault.getPoolTokens(poolId)).lastChangeBlock).to.equal(blockNumber);
                      expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).lastChangeBlock).to.equal(
                        blockNumber
                      );
                      expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).lastChangeBlock).to.be.lt(
                        blockNumber
                      );
                    });
                  }

                  it('sets the managed balance', async () => {
                    const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

                    const ops = [{ kind, poolId, token: tokens.DAI.address, amount }];
                    await vault.connect(sender).managePoolBalance(ops);

                    const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
                    expect(currentBalance.cash).to.equal(previousBalance.cash);
                    expect(currentBalance.managed).to.equal(amount);

                    expect(currentBalance.lastChangeBlock).to.equal(await lastBlockNumber());
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

              context('when paused', () => {
                sharedBeforeEach('pause', async () => {
                  const action = await actionId(vault, 'setPaused');
                  await authorizer.connect(admin).grantRole(action, admin.address);
                  await vault.connect(admin).setPaused(true);
                });

                it('reverts', async () => {
                  const ops = [{ kind, poolId, token: tokens.DAI.address, amount: bn(0) }];
                  await expect(vault.connect(sender).managePoolBalance(ops)).to.be.revertedWith('PAUSED');
                });
              });
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

        describe('batch', () => {
          context('with single pool', () => {
            context('with the same managed token', () => {
              it('succeeds', async () => {
                const ops = [
                  { poolId, kind: OP_KIND.WITHDRAW, amount: 5, token: tokens.DAI.address },
                  { poolId, kind: OP_KIND.DEPOSIT, amount: 3, token: tokens.DAI.address },
                  { poolId, kind: OP_KIND.UPDATE, amount: 10, token: tokens.DAI.address },
                  { poolId, kind: OP_KIND.WITHDRAW, amount: 6, token: tokens.DAI.address },
                ];

                const totalWithdraw = bn(5 - 3 + 6);
                const totalManaged = bn(10 + 6); // The update overwrites the prior withdraw and deposit

                const preBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

                await expectBalanceChange(() => vault.connect(assetManager).managePoolBalance(ops), tokens, [
                  {
                    account: vault,
                    changes: { DAI: totalWithdraw.mul(-1) },
                  },
                  {
                    account: assetManager,
                    changes: { DAI: totalWithdraw },
                  },
                ]);

                const postBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
                expect(preBalance.cash.sub(postBalance.cash)).to.equal(totalWithdraw);
                expect(postBalance.managed).to.equal(totalManaged);
              });
            });

            context('with managed and unmanaged tokens', () => {
              it('reverts', async () => {
                const ops = [
                  { poolId, kind: OP_KIND.WITHDRAW, amount: 5, token: tokens.DAI.address },
                  { poolId, kind: OP_KIND.DEPOSIT, amount: 3, token: tokens.DAI.address },
                  { poolId, kind: OP_KIND.UPDATE, amount: 0, token: tokens.MKR.address }, // Unmanaged
                  { poolId, kind: OP_KIND.WITHDRAW, amount: 6, token: tokens.DAI.address },
                ];

                await expect(vault.connect(assetManager).managePoolBalance(ops)).to.be.revertedWith(
                  'SENDER_NOT_ASSET_MANAGER'
                );
              });
            });

            context('with managed and unregistered tokens', () => {
              it('reverts', async () => {
                const ops = [
                  { poolId, kind: OP_KIND.WITHDRAW, amount: 5, token: tokens.DAI.address },
                  { poolId, kind: OP_KIND.DEPOSIT, amount: 3, token: tokens.DAI.address },
                  { poolId, kind: OP_KIND.UPDATE, amount: 0, token: vault.address }, // Unregistered
                  { poolId, kind: OP_KIND.WITHDRAW, amount: 6, token: tokens.DAI.address },
                ];

                await expect(vault.connect(assetManager).managePoolBalance(ops)).to.be.revertedWith(
                  'TOKEN_NOT_REGISTERED'
                );
              });
            });
          });

          context('with multiple pools', () => {
            let poolIdA: string;
            let poolIdB: string;

            sharedBeforeEach('deploy other pool and add liquidity', async () => {
              poolIdA = poolId;

              const otherPool = await deploy('MockPool', { args: [vault.address, specialization] });
              poolIdB = await otherPool.getPoolId();

              // Manage all tokens in Pool B
              const assetManagers = tokens.addresses.map(() => assetManager.address);

              await otherPool.registerTokens(tokens.addresses, assetManagers);

              await vault.connect(lp).joinPool(poolIdB, lp.address, other.address, {
                assets: tokens.addresses,
                maxAmountsIn: tokens.addresses.map(() => MAX_UINT256),
                fromInternalBalance: false,
                userData: encodeJoin(
                  tokens.addresses.map(() => tokenInitialBalance),
                  tokens.addresses.map(() => 0)
                ),
              });
            });

            context('with the same managed token', () => {
              it('succeeds', async () => {
                const ops = [
                  { poolId: poolIdA, kind: OP_KIND.WITHDRAW, amount: 5, token: tokens.DAI.address },
                  { poolId: poolIdB, kind: OP_KIND.UPDATE, amount: 10, token: tokens.DAI.address },
                  { poolId: poolIdB, kind: OP_KIND.WITHDRAW, amount: 7, token: tokens.DAI.address },
                  { poolId: poolIdA, kind: OP_KIND.DEPOSIT, amount: 2, token: tokens.DAI.address },
                ];

                const totalWithdrawA = bn(5 - 2);
                const totalManagedA = bn(5 - 2);

                const totalWithdrawB = bn(7);
                const totalManagedB = bn(10 + 7);

                const preBalanceA = await vault.getPoolTokenInfo(poolIdA, tokens.DAI.address);
                const preBalanceB = await vault.getPoolTokenInfo(poolIdB, tokens.DAI.address);

                await expectBalanceChange(() => vault.connect(assetManager).managePoolBalance(ops), tokens, [
                  {
                    account: vault,
                    changes: { DAI: totalWithdrawA.add(totalWithdrawB).mul(-1) },
                  },
                  {
                    account: assetManager,
                    changes: { DAI: totalWithdrawA.add(totalWithdrawB) },
                  },
                ]);

                const postBalanceA = await vault.getPoolTokenInfo(poolIdA, tokens.DAI.address);
                const postBalanceB = await vault.getPoolTokenInfo(poolIdB, tokens.DAI.address);

                expect(preBalanceA.cash.sub(postBalanceA.cash)).to.equal(totalWithdrawA);
                expect(postBalanceA.managed).to.equal(totalManagedA);

                expect(preBalanceB.cash.sub(postBalanceB.cash)).to.equal(totalWithdrawB);
                expect(postBalanceB.managed).to.equal(totalManagedB);
              });
            });

            context('with multiple managed tokens', () => {
              it('succeeds', async () => {
                const ops = [
                  { poolId: poolIdA, kind: OP_KIND.WITHDRAW, amount: 5, token: tokens.DAI.address },
                  { poolId: poolIdB, kind: OP_KIND.UPDATE, amount: 10, token: tokens.DAI.address },
                  { poolId: poolIdB, kind: OP_KIND.WITHDRAW, amount: 7, token: tokens.DAI.address },
                  { poolId: poolIdB, kind: OP_KIND.WITHDRAW, amount: 7, token: tokens.MKR.address },
                  { poolId: poolIdB, kind: OP_KIND.DEPOSIT, amount: 1, token: tokens.MKR.address },
                  { poolId: poolIdA, kind: OP_KIND.DEPOSIT, amount: 2, token: tokens.DAI.address },
                ];

                const totalDAIWithdrawA = bn(5 - 2);
                const totalDAIManagedA = bn(5 - 2);

                const totalDAIWithdrawB = bn(7);
                const totalDAIManagedB = bn(10 + 7);

                const totalMKRWithdrawB = bn(7 - 1);
                const totalMKRManagedB = bn(7 - 1);

                const preDAIBalanceA = await vault.getPoolTokenInfo(poolIdA, tokens.DAI.address);
                const preDAIBalanceB = await vault.getPoolTokenInfo(poolIdB, tokens.DAI.address);

                const preMKRBalanceB = await vault.getPoolTokenInfo(poolIdB, tokens.MKR.address);

                await expectBalanceChange(() => vault.connect(assetManager).managePoolBalance(ops), tokens, [
                  {
                    account: vault,
                    changes: {
                      DAI: totalDAIWithdrawA.add(totalDAIWithdrawB).mul(-1),
                      MKR: totalMKRWithdrawB.mul(-1),
                    },
                  },
                  {
                    account: assetManager,
                    changes: {
                      DAI: totalDAIWithdrawA.add(totalDAIWithdrawB),
                      MKR: totalMKRWithdrawB,
                    },
                  },
                ]);

                const postDAIBalanceA = await vault.getPoolTokenInfo(poolIdA, tokens.DAI.address);
                const postDAIBalanceB = await vault.getPoolTokenInfo(poolIdB, tokens.DAI.address);

                const postMKRBalanceB = await vault.getPoolTokenInfo(poolIdB, tokens.MKR.address);

                expect(preDAIBalanceA.cash.sub(postDAIBalanceA.cash)).to.equal(totalDAIWithdrawA);
                expect(postDAIBalanceA.managed).to.equal(totalDAIManagedA);

                expect(preDAIBalanceB.cash.sub(postDAIBalanceB.cash)).to.equal(totalDAIWithdrawB);
                expect(postDAIBalanceB.managed).to.equal(totalDAIManagedB);

                expect(preMKRBalanceB.cash.sub(postMKRBalanceB.cash)).to.equal(totalMKRWithdrawB);
                expect(postMKRBalanceB.managed).to.equal(totalMKRManagedB);
              });
            });

            context('with managed and unmanaged tokens', () => {
              it('reverts', async () => {
                const ops = [
                  { poolId: poolIdA, kind: OP_KIND.WITHDRAW, amount: 5, token: tokens.DAI.address },
                  { poolId: poolIdA, kind: OP_KIND.UPDATE, amount: 10, token: tokens.MKR.address }, // Unmanaged
                  { poolId: poolIdB, kind: OP_KIND.WITHDRAW, amount: 7, token: tokens.DAI.address },
                  { poolId: poolIdB, kind: OP_KIND.WITHDRAW, amount: 7, token: tokens.MKR.address },
                  { poolId: poolIdA, kind: OP_KIND.DEPOSIT, amount: 2, token: tokens.DAI.address },
                ];

                await expect(vault.connect(assetManager).managePoolBalance(ops)).to.be.revertedWith(
                  'SENDER_NOT_ASSET_MANAGER'
                );
              });
            });

            context('with registered and unregistered pools', () => {
              it('reverts', async () => {
                const invalidPoolId = '0x1234123412341234123412341234123412341234123412341234123412341234';
                const ops = [
                  { poolId: poolIdA, kind: OP_KIND.WITHDRAW, amount: 5, token: tokens.DAI.address },
                  { poolId: poolIdB, kind: OP_KIND.UPDATE, amount: 10, token: tokens.MKR.address },
                  { poolId: poolIdB, kind: OP_KIND.WITHDRAW, amount: 7, token: tokens.MKR.address },
                  { poolId: invalidPoolId, kind: OP_KIND.WITHDRAW, amount: 7, token: tokens.MKR.address }, // Invalid
                  { poolId: poolIdA, kind: OP_KIND.DEPOSIT, amount: 2, token: tokens.DAI.address },
                ];

                await expect(vault.connect(assetManager).managePoolBalance(ops)).to.be.revertedWith('INVALID_POOL_ID');
              });
            });
          });
        });
      });
    });
  }
});
