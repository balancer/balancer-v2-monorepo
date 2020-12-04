import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import * as expectEvent from '../helpers/expectEvent';
import { deploy } from '../../scripts/helpers/deploy';
import { deployTokens, mintTokens, TokenList } from '../helpers/tokens';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '../helpers/constants';
import { PoolSpecializationSetting, MinimalSwapInfoPool, GeneralPool, TwoTokenPool } from '../../scripts/helpers/pools';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { toFixedPoint } from '../../scripts/helpers/fixedPoint';

let admin: SignerWithAddress;
let pool: SignerWithAddress;
let lp: SignerWithAddress;
let feeSetter: SignerWithAddress;
let other: SignerWithAddress;

let authorizer: Contract;
let vault: Contract;
let symbols: string[];
let tokens: TokenList = {};

describe('Vault - pool registry', () => {
  before(async () => {
    [, admin, pool, lp, feeSetter, other] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    symbols = ['DAI', 'MKR', 'SNX'];
    tokens = await deployTokens(symbols, [18, 18, 18]);

    for (const symbol in tokens) {
      // Mint tokens for the lp to deposit in the Vault
      await mintTokens(tokens, symbol, lp, 50000);
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      // Also mint some tokens for the pool itself
      await mintTokens(tokens, symbol, pool, 50000);
      await tokens[symbol].connect(pool).approve(vault.address, MAX_UINT256);
    }
  });

  describe('pool creation', () => {
    it('anyone can create pools', async () => {
      const receipt = await (await vault.connect(pool).registerPool(GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      const poolId = event.args.poolId;

      expect(poolId).to.not.be.undefined;
    });

    it('pools require a valid pool specialization setting', async () => {
      // The existing pool specialization settings are general, minimal swap info and two tokens (0, 1 and 2)
      await expect(vault.registerPool(3)).to.be.reverted;
    });
  });

  describe('pool properties', () => {
    let poolId: string;

    beforeEach(async () => {
      const receipt = await (await vault.connect(pool).registerPool(GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      poolId = event.args.poolId;
    });

    it('new pool is added to pool list', async () => {
      expect(await vault.getNumberOfPools()).to.equal(1);
      expect(await vault.getPoolIds(0, 1)).to.have.members([poolId]);
    });

    it('has an address and an specialization setting', async () => {
      expect(await vault.getPool(poolId)).to.deep.equal([pool.address, GeneralPool]);
    });

    it('starts with no tokens', async () => {
      expect(await vault.getPoolTokens(poolId)).to.have.members([]);
    });

    it('gets a new id', async () => {
      const receipt = await (await vault.registerPool(GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      const otherPoolId = event.args.poolId;

      expect(poolId).to.not.equal(otherPoolId);
      expect(await vault.getNumberOfPools()).to.equal(2);
      expect(await vault.getPoolIds(0, 2)).to.have.members([poolId, otherPoolId]);
    });
  });

  describe('token management', () => {
    function itManagesTokensCorrectly(specialization: PoolSpecializationSetting) {
      let poolId: string;

      beforeEach(async () => {
        const receipt = await (await vault.connect(pool).registerPool(specialization)).wait();

        const event = expectEvent.inReceipt(receipt, 'PoolCreated');
        poolId = event.args.poolId;

        const assetManagers = [ZERO_ADDRESS, ZERO_ADDRESS];

        await vault.connect(pool).registerTokens(poolId, [tokens.DAI.address, tokens.MKR.address], assetManagers);
      });

      if (specialization != TwoTokenPool) {
        it('pool can add liquidity to single token', async () => {
          await vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address], [5], false);

          expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address])).to.deep.equal([BigNumber.from(5)]);
        });
      }

      it('reverts when querying token balances of unregistered tokens', async () => {
        const error = 'ERR_TOKEN_NOT_REGISTERED';
        await expect(vault.getPoolTokenBalances(poolId, [ZERO_ADDRESS])).to.be.revertedWith(error);
        await expect(vault.getPoolTokenBalances(poolId, [tokens.SNX.address])).to.be.revertedWith(error);
      });

      it('reverts when querying token balances of unexisting pools', async () => {
        const error = 'Nonexistent pool';
        await expect(vault.getPoolTokenBalances(ZERO_BYTES32, [ZERO_ADDRESS])).to.be.revertedWith(error);
        await expect(vault.getPoolTokenBalances(ZERO_BYTES32, [tokens.SNX.address])).to.be.revertedWith(error);
      });

      it('pool can add liquidity to multiple tokens', async () => {
        await vault
          .connect(pool)
          .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false);

        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
          BigNumber.from(5),
          BigNumber.from(10),
        ]);
      });

      it('pool cannot add liquidity for the zero address token', async () => {
        await expect(
          vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address, ZERO_ADDRESS], [5, 10], false)
        ).to.be.revertedWith('Address: call to non-contract');

        await expect(
          vault.connect(pool).addLiquidity(poolId, pool.address, [ZERO_ADDRESS, tokens.MKR.address], [5, 10], false)
        ).to.be.revertedWith('Address: call to non-contract');
      });

      it('the pool can add zero liquidity to registered tokens', async () => {
        await vault
          .connect(pool)
          .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 0], false);

        await vault
          .connect(pool)
          .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [0, 10], false);

        const balances = await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address]);
        expect(balances).to.deep.equal([BigNumber.from(5), BigNumber.from(10)]);
      });

      it('the pool cannot add liquidity with mismatching tokens and lengths', async () => {
        await expect(
          vault
            .connect(pool)
            .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10, 15], false)
        ).to.be.revertedWith('Tokens and total amounts length mismatch');
      });

      it('the pool can add liquidity multiple times', async () => {
        await vault
          .connect(pool)
          .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [3, 7], false);
        await vault
          .connect(pool)
          .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false);

        expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
          BigNumber.from(8),
          BigNumber.from(17),
        ]);
      });

      it('tokens are pulled from the lp when adding liquidity', async () => {
        await vault.connect(lp).addUserAgent(pool.address);

        await expectBalanceChange(
          () =>
            vault
              .connect(pool)
              .addLiquidity(poolId, lp.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false),
          tokens,
          [
            { account: lp, changes: { DAI: -5, MKR: -10 } },
            { account: vault.address, changes: { DAI: 5, MKR: 10 } },
          ]
        );
      });

      it('the pool must be an agent for the lp to adding liquidity', async () => {
        await expect(
          vault.connect(pool).addLiquidity(poolId, lp.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false)
        ).to.be.revertedWith('Caller is not an agent');
      });

      it('the pool can add liquidity by withdrawing tokens from the internal balance', async () => {
        await vault.connect(pool).depositToInternalBalance(tokens.DAI.address, 50, pool.address);
        await vault.connect(pool).depositToInternalBalance(tokens.MKR.address, 100, pool.address);

        await expectBalanceChange(
          () =>
            vault
              .connect(pool)
              .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], true),
          tokens,
          [{ account: pool }]
        );

        expect(await vault.getInternalBalance(pool.address, tokens.DAI.address)).to.equal(45); // 5 out of 50 taken
        expect(await vault.getInternalBalance(pool.address, tokens.MKR.address)).to.equal(90); // 10 out of 100 taken
      });

      it('the pool can add liquidity by both transferring and withdrawing tokens from the internal balance', async () => {
        await vault.connect(pool).depositToInternalBalance(tokens.DAI.address, 3, pool.address);
        await vault.connect(pool).depositToInternalBalance(tokens.MKR.address, 6, pool.address);

        await expectBalanceChange(
          () =>
            vault
              .connect(pool)
              .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], true),
          tokens,
          [{ account: pool, changes: { DAI: -2, MKR: -4 } }]
        );

        expect(await vault.getInternalBalance(pool.address, tokens.DAI.address)).to.equal(0);
        expect(await vault.getInternalBalance(pool.address, tokens.MKR.address)).to.equal(0);
      });

      it('non-pool cannot add liquidity', async () => {
        await expect(
          vault
            .connect(other)
            .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false)
        ).to.be.revertedWith('Caller is not the pool');
      });

      if (specialization == TwoTokenPool) {
        it('the pool cannot add liquidity to single token', async () => {
          await expect(
            vault.connect(pool).addLiquidity(poolId, pool.address, [tokens.DAI.address], [5], false)
          ).to.be.revertedWith('ERR_TOKENS_LENGTH_MUST_BE_2');
        });

        it('the pool cannot add liquidity to more than two tokens', async () => {
          await expect(
            vault
              .connect(pool)
              .addLiquidity(
                poolId,
                pool.address,
                [tokens.DAI.address, tokens.MKR.address, tokens.SNX.address],
                [5, 10, 15],
                false
              )
          ).to.be.revertedWith('ERR_TOKENS_LENGTH_MUST_BE_2');
        });

        it('the pool cannot add liquidity to repeated tokens', async () => {
          await expect(
            vault
              .connect(pool)
              .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.DAI.address], [5, 10], false)
          ).to.be.revertedWith('ERR_TOKEN_NOT_REGISTERED');
        });
      }

      context('with added liquidity', () => {
        beforeEach(async () => {
          await vault
            .connect(pool)
            .addLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false);
        });

        if (specialization != TwoTokenPool) {
          it('the pool can remove zero liquidity from single token', async () => {
            await vault.connect(pool).removeLiquidity(poolId, pool.address, [tokens.MKR.address], [0], false);

            expect(await vault.getPoolTokens(poolId)).to.include.members([tokens.DAI.address, tokens.MKR.address]);
            expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
              BigNumber.from(5),
              BigNumber.from(10),
            ]);
          });

          it('the pool can remove partial liquidity from single token', async () => {
            await vault.connect(pool).removeLiquidity(poolId, pool.address, [tokens.MKR.address], [8], false);

            expect(await vault.getPoolTokens(poolId)).to.include.members([tokens.DAI.address, tokens.MKR.address]);
            expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
              BigNumber.from(5),
              BigNumber.from(2),
            ]);
          });

          it('the pool can remove all liquidity from single token', async () => {
            await vault.connect(pool).removeLiquidity(poolId, pool.address, [tokens.MKR.address], [10], false);

            expect(await vault.getPoolTokens(poolId)).to.include.members([tokens.DAI.address]);
            expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address])).to.deep.equal([BigNumber.from(5)]);
          });
        }

        if (specialization == TwoTokenPool) {
          it('the pool cannot remove zero liquidity from single token', async () => {
            await expect(
              vault.connect(pool).removeLiquidity(poolId, pool.address, [tokens.MKR.address], [0], false)
            ).to.be.revertedWith('ERR_TOKENS_LENGTH_MUST_BE_2');
          });
        }

        it('the pool can remove zero liquidity from multiple tokens', async () => {
          await vault
            .connect(pool)
            .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [0, 3], false);

          expect(await vault.getPoolTokens(poolId)).to.include.members([tokens.DAI.address, tokens.MKR.address]);
          expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
            BigNumber.from(5),
            BigNumber.from(7),
          ]);
        });

        it('the pool can remove partial liquidity from multiple tokens', async () => {
          await vault
            .connect(pool)
            .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [2, 3], false);

          expect(await vault.getPoolTokens(poolId)).to.include.members([tokens.DAI.address, tokens.MKR.address]);
          expect(await vault.getPoolTokenBalances(poolId, [tokens.DAI.address, tokens.MKR.address])).to.deep.equal([
            BigNumber.from(3),
            BigNumber.from(7),
          ]);
        });

        it('the pool can remove all liquidity from multiple tokens', async () => {
          await vault
            .connect(pool)
            .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [5, 10], false);

          expect(await vault.getPoolTokens(poolId)).to.include.members([tokens.DAI.address, tokens.MKR.address]);
        });

        it('the pool can remove liquidity by depositing tokens into internal balance', async () => {
          await expectBalanceChange(
            () =>
              vault
                .connect(pool)
                .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [4, 8], true),
            tokens,
            [{ account: pool }]
          );

          expect(await vault.getInternalBalance(pool.address, tokens.DAI.address)).to.equal(4);
          expect(await vault.getInternalBalance(pool.address, tokens.MKR.address)).to.equal(8);
        });

        it('tokens are pushed to lp when removing liquidity', async () => {
          await expectBalanceChange(
            () =>
              vault
                .connect(pool)
                .removeLiquidity(poolId, lp.address, [tokens.DAI.address, tokens.MKR.address], [2, 7], false),
            tokens,
            [
              { account: vault.address, changes: { DAI: -2, MKR: -7 } },
              { account: lp, changes: { DAI: 2, MKR: 7 } },
            ]
          );
        });

        it('the controller cannot remove zero liquidity not in pool', async () => {
          await expect(
            vault
              .connect(pool)
              .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.SNX.address], [5, 0], false)
          ).to.be.revertedWith('ERR_TOKEN_NOT_REGISTERED');
        });

        it('the controller cannot remove non-zero liquidity not in pool', async () => {
          await expect(
            vault
              .connect(pool)
              .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.SNX.address], [5, 2], false)
          ).to.be.revertedWith('ERR_TOKEN_NOT_REGISTERED');
        });

        it('non-pool cannot remove liquidity', async () => {
          await expect(
            vault
              .connect(other)
              .removeLiquidity(poolId, pool.address, [tokens.DAI.address, tokens.MKR.address], [0, 0], false)
          ).to.be.revertedWith('Caller is not the pool');
        });
      });
    }

    describe('with general pool', () => {
      itManagesTokensCorrectly(GeneralPool);
    });

    describe('with minimal swap info pool', () => {
      itManagesTokensCorrectly(MinimalSwapInfoPool);
    });

    describe('with two token pool', () => {
      itManagesTokensCorrectly(TwoTokenPool);
    });
  });

  describe('token registration', () => {
    let poolId: string;
    let tokenAddresses: string[] = [];
    let assetManagers: string[] = [];

    const setTokensAddresses = (length: number) => {
      beforeEach('define token addresses', () => {
        tokenAddresses = symbols.slice(0, length).map((symbol: string) => tokens[symbol].address);
        assetManagers = symbols.slice(0, length).map(() => ZERO_ADDRESS);
      });
    };

    describe('register', () => {
      const itHandlesTokensRegistrationProperly = (specialization: PoolSpecializationSetting) => {
        context('when the pool was created', () => {
          beforeEach('create pool', async () => {
            const receipt = await (await vault.connect(pool).registerPool(specialization)).wait();
            const event = expectEvent.inReceipt(receipt, 'PoolCreated');
            poolId = event.args.poolId;
          });

          context('when the sender is the pool', () => {
            beforeEach('set pool as sender', () => {
              vault = vault.connect(pool);
            });

            context('when the given addresses where not registered yet', () => {
              context('when one of the given tokens is the zero address', () => {
                beforeEach('update token list to use zero address', () => {
                  tokenAddresses[0] = ZERO_ADDRESS;
                  tokenAddresses[1] = tokens['DAI'].address;
                });

                it('reverts', async () => {
                  const error = 'ERR_TOKEN_CANT_BE_ZERO';
                  await expect(vault.registerTokens(poolId, tokenAddresses, assetManagers)).to.be.revertedWith(error);
                  await expect(
                    vault.registerTokens(poolId, tokenAddresses.reverse(), assetManagers)
                  ).to.be.revertedWith(error);
                });
              });

              context('when none of the tokens is the zero address', () => {
                const itRegistersTheTokens = () => {
                  it('registers the requested tokens', async () => {
                    await vault.registerTokens(poolId, tokenAddresses, assetManagers);

                    const poolTokens = await vault.getPoolTokens(poolId);
                    expect(poolTokens).to.have.members(tokenAddresses);

                    const poolBalances = await vault.getPoolTokenBalances(poolId, tokenAddresses);
                    expect(poolBalances).to.deep.equal(tokenAddresses.map(() => BigNumber.from(0)));
                  });

                  it('emits an event', async () => {
                    const receipt = await (await vault.registerTokens(poolId, tokenAddresses, assetManagers)).wait();
                    expectEvent.inReceipt(receipt, 'TokensRegistered', { poolId, tokens: tokenAddresses });
                  });

                  if (specialization == TwoTokenPool) {
                    it('cannot be registered individually', async () => {
                      const error = 'ERR_TOKENS_LENGTH_MUST_BE_2';
                      await expect(
                        vault.registerTokens(poolId, [tokenAddresses[0]], [assetManagers[0]])
                      ).to.be.revertedWith(error);
                    });
                  } else {
                    it('can be registered individually', async () => {
                      for (const tokenAddress of tokenAddresses) {
                        await vault.registerTokens(poolId, [tokenAddress], [ZERO_ADDRESS]);
                      }

                      const poolTokens = await vault.getPoolTokens(poolId);
                      expect(poolTokens).to.have.members(tokenAddresses);

                      const poolBalances = await vault.getPoolTokenBalances(poolId, tokenAddresses);
                      expect(poolBalances).to.deep.equal(tokenAddresses.map(() => BigNumber.from(0)));
                    });
                  }
                };

                const itRevertsDueToTwoTokens = () => {
                  it('reverts', async () => {
                    const error = 'ERR_TOKENS_LENGTH_MUST_BE_2';
                    await expect(vault.registerTokens(poolId, tokenAddresses, assetManagers)).to.be.revertedWith(error);
                  });
                };

                context('with one token', () => {
                  setTokensAddresses(1);
                  specialization === TwoTokenPool ? itRevertsDueToTwoTokens() : itRegistersTheTokens();
                });

                context('with two tokens', () => {
                  setTokensAddresses(2);
                  itRegistersTheTokens();
                });

                context('with three tokens', () => {
                  setTokensAddresses(3);
                  specialization === TwoTokenPool ? itRevertsDueToTwoTokens() : itRegistersTheTokens();
                });
              });
            });

            context('when one of the given tokens was already registered', () => {
              setTokensAddresses(2);

              beforeEach('register tokens', async () => {
                await vault.registerTokens(poolId, tokenAddresses, assetManagers);
              });

              it('reverts', async () => {
                const error =
                  specialization == TwoTokenPool ? 'ERR_TOKENS_ALREADY_SET' : 'ERR_TOKEN_ALREADY_REGISTERED';
                await expect(vault.registerTokens(poolId, tokenAddresses, assetManagers)).to.be.revertedWith(error);
              });
            });
          });

          context('when the sender is not the pool', () => {
            beforeEach('set other sender', () => {
              vault = vault.connect(other);
            });

            it('reverts', async () => {
              await expect(vault.registerTokens(poolId, tokenAddresses, assetManagers)).to.be.revertedWith(
                'Caller is not the pool'
              );
            });
          });
        });

        context('when the pool was not created', () => {
          it('reverts', async () => {
            await expect(vault.registerTokens(ZERO_BYTES32, tokenAddresses, assetManagers)).to.be.revertedWith(
              'Nonexistent pool'
            );
          });
        });
      };

      context('for a minimal swap info pool', () => {
        itHandlesTokensRegistrationProperly(MinimalSwapInfoPool);
      });

      context('for a general pool', () => {
        itHandlesTokensRegistrationProperly(GeneralPool);
      });

      context('for a two token pool', () => {
        itHandlesTokensRegistrationProperly(TwoTokenPool);
      });
    });

    describe('unregister', () => {
      const itHandlesTokensDeregistrationProperly = (specialization: PoolSpecializationSetting) => {
        context('when the pool was created', () => {
          beforeEach('create pool', async () => {
            const receipt = await (await vault.connect(pool).registerPool(specialization)).wait();
            const event = expectEvent.inReceipt(receipt, 'PoolCreated');
            poolId = event.args.poolId;
          });

          context('when the sender is the pool', () => {
            beforeEach('set pool as sender', () => {
              vault = vault.connect(pool);
            });

            context('when the given addresses where registered', () => {
              const itUnregistersTheTokens = () => {
                beforeEach('register tokens', async () => {
                  await vault.registerTokens(poolId, tokenAddresses, assetManagers);
                });

                context('when some tokens still have some balance', () => {
                  beforeEach('add some balance', async () => {
                    const balances = tokenAddresses.map(() => 5);
                    await vault.addLiquidity(poolId, pool.address, tokenAddresses, balances, false);
                  });

                  context('when trying to unregister individually', () => {
                    if (specialization == TwoTokenPool) {
                      it('reverts', async () => {
                        const error = 'ERR_TOKENS_LENGTH_MUST_BE_2';
                        await expect(vault.unregisterTokens(poolId, [tokenAddresses[0]])).to.be.revertedWith(error);
                      });
                    } else {
                      it('can unregister the tokens without balance', async () => {
                        await vault.removeLiquidity(poolId, pool.address, [tokenAddresses[0]], [5], false);
                        await vault.unregisterTokens(poolId, [tokenAddresses[0]]);

                        const poolTokens = await vault.getPoolTokens(poolId);
                        expect(poolTokens).not.to.have.members([tokenAddresses[0]]);
                      });
                    }
                  });

                  context('when trying to unregister all tokens at once', () => {
                    it('reverts', async () => {
                      const error = 'ERR_TOKEN_BALANCE_IS_NOT_ZERO';
                      await expect(vault.unregisterTokens(poolId, tokenAddresses)).to.be.revertedWith(error);
                    });
                  });
                });

                context('when all the tokens have no balance', () => {
                  it('unregisters the requested tokens', async () => {
                    await vault.unregisterTokens(poolId, tokenAddresses);

                    const poolTokens = await vault.getPoolTokens(poolId);
                    expect(poolTokens).to.be.empty;
                  });

                  it('cannot query balances any more', async () => {
                    await vault.unregisterTokens(poolId, tokenAddresses);

                    const error = 'ERR_TOKEN_NOT_REGISTERED';
                    await expect(vault.getPoolTokenBalances(poolId, tokenAddresses)).to.be.revertedWith(error);
                  });

                  it('emits an event', async () => {
                    const receipt = await (await vault.unregisterTokens(poolId, tokenAddresses)).wait();
                    expectEvent.inReceipt(receipt, 'TokensUnregistered', { poolId, tokens: tokenAddresses });
                  });
                });
              };

              const itRevertsDueToTwoTokens = () => {
                it('reverts', async () => {
                  const error = 'ERR_TOKENS_LENGTH_MUST_BE_2';
                  await expect(vault.unregisterTokens(poolId, tokenAddresses)).to.be.revertedWith(error);
                });
              };

              context('with one token', () => {
                setTokensAddresses(1);
                specialization === TwoTokenPool ? itRevertsDueToTwoTokens() : itUnregistersTheTokens();
              });

              context('with two tokens', () => {
                setTokensAddresses(2);
                itUnregistersTheTokens();
              });

              context('with three tokens', () => {
                setTokensAddresses(3);
                specialization === TwoTokenPool ? itRevertsDueToTwoTokens() : itUnregistersTheTokens();
              });
            });

            context('when one of the given addresses was not registered', () => {
              setTokensAddresses(2);

              it('reverts', async () => {
                const error = 'ERR_TOKEN_NOT_REGISTERED';
                await expect(vault.unregisterTokens(poolId, tokenAddresses)).to.be.revertedWith(error);
              });
            });
          });

          context('when the sender is not the pool', () => {
            beforeEach('set other sender', () => {
              vault = vault.connect(other);
            });

            it('reverts', async () => {
              await expect(vault.unregisterTokens(poolId, tokenAddresses)).to.be.revertedWith('Caller is not the pool');
            });
          });
        });

        context('when the pool was not created', () => {
          it('reverts', async () => {
            await expect(vault.unregisterTokens(ZERO_BYTES32, tokenAddresses)).to.be.revertedWith('Nonexistent pool');
          });
        });
      };

      context('for a minimal swap info pool', () => {
        itHandlesTokensDeregistrationProperly(MinimalSwapInfoPool);
      });

      context('for a general pool', () => {
        itHandlesTokensDeregistrationProperly(GeneralPool);
      });

      context('for a two token pool', () => {
        itHandlesTokensDeregistrationProperly(TwoTokenPool);
      });
    });
  });

  describe('protocol swap fee collection', async () => {
    let pool: Contract;
    let poolId: string;

    beforeEach('deploy pool', async () => {
      await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), feeSetter.address);
      await vault.connect(feeSetter).setProtocolSwapFee(toFixedPoint(0.01)); // 1%

      pool = await deploy('MockPool', {
        args: [vault.address, MinimalSwapInfoPool],
      });

      poolId = await pool.getPoolId();

      // Let pool use lp's tokens
      await vault.connect(lp).addUserAgent(pool.address);

      await pool.connect(lp).registerTokens([tokens.DAI.address, tokens.MKR.address], [ZERO_ADDRESS, ZERO_ADDRESS]);
      await pool.connect(lp).addLiquidity([tokens.DAI.address, tokens.MKR.address], [1000, 1000]);
    });

    // Each entry in the fees array contains a token symbol, the amount of collected fees to report, and the amount of
    // fees the test expects the vault to charge
    async function assertFeesArePaid(
      fees: { symbol: string; reported: number | BigNumber; expectedPaid: number | BigNumber }[]
    ) {
      const tokenAddresses = fees.map(({ symbol }) => tokens[symbol].address);
      const reportedAmounts = fees.map(({ reported }) => reported);

      const previousBalances = await vault.getPoolTokenBalances(poolId, tokenAddresses);

      const receipt = await (await pool.paySwapProtocolFees(tokenAddresses, reportedAmounts)).wait();

      // The vault returns the updated balance for tokens for which fees were paid
      const event = expectEvent.inReceipt(receipt, 'UpdatedBalances');
      const newBalances = await vault.getPoolTokenBalances(poolId, tokenAddresses);
      expect(newBalances).to.deep.equal(event.args.balances);

      for (let i = 0; i < fees.length; ++i) {
        expect(await vault.getCollectedFeesByToken(tokens[fees[i].symbol].address)).to.equal(fees[i].expectedPaid);
        expect(previousBalances[i].sub(newBalances[i])).to.equal(fees[i].expectedPaid);
      }
    }

    it('pools can pay fees in a single token', async () => {
      await assertFeesArePaid([{ symbol: 'DAI', reported: 500, expectedPaid: 5 }]);
    });

    it('pools can pay fees in multiple tokens', async () => {
      await assertFeesArePaid([
        { symbol: 'DAI', reported: 500, expectedPaid: 5 },
        { symbol: 'MKR', reported: 1000, expectedPaid: 10 },
      ]);
    });

    it('pools can pay zero fees', async () => {
      await assertFeesArePaid([{ symbol: 'DAI', reported: 0, expectedPaid: 0 }]);
    });

    it('the vault charges nothing if the protocol fee is 0', async () => {
      await vault.connect(feeSetter).setProtocolSwapFee(toFixedPoint(0));
      await assertFeesArePaid([{ symbol: 'DAI', reported: 500, expectedPaid: 0 }]);
    });

    it.skip('protocol fees are always rounded up', async () => {
      // TODO: we're not always rounding up yet
      await assertFeesArePaid([
        { symbol: 'DAI', reported: 499, expectedPaid: 5 }, // 1% of 499 is 4.99
        { symbol: 'MKR', reported: 501, expectedPaid: 6 }, // 1% of 501 is 5.01
      ]);
    });

    it('reverts if the caller is not the pool', async () => {
      await expect(vault.connect(other).paySwapProtocolFees(poolId, [tokens.DAI.address], [0])).to.be.revertedWith(
        'Caller is not the pool'
      );
    });

    it('reverts when paying fees in tokens no in the pool', async () => {
      const newTokens = await deployTokens(['BAT'], [18]);
      const error = 'ERR_TOKEN_NOT_REGISTERED';
      await expect(pool.paySwapProtocolFees([newTokens.BAT.address], [0])).to.be.revertedWith(error);
    });

    it('reverts if the fees are larger than the pool balance', async () => {
      // The pool has 1000 tokens, and will be charged 1% of the reported amount. 1001 / 1% is 100100
      await expect(pool.paySwapProtocolFees([tokens.DAI.address], [100100])).to.be.revertedWith('ERR_SUB_UNDERFLOW');
    });
  });
});
