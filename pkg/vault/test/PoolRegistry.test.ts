import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { encodeExit, encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';

import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { PoolSpecialization } from '@balancer-labs/balancer-js';
import TokensDeployer from '@balancer-labs/v2-helpers/src/models/tokens/TokensDeployer';
import { lastBlockNumber } from '@balancer-labs/v2-helpers/src/time';

describe('PoolRegistry', () => {
  let admin: SignerWithAddress, lp: SignerWithAddress, other: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let allTokens: TokenList;

  before(async () => {
    [, admin, lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    const weth = await TokensDeployer.deployToken({ symbol: 'WETH' });

    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address, weth.address, 0, 0] });

    allTokens = await TokenList.create(['DAI', 'MKR', 'SNX'], { sorted: true });
    await allTokens.mint({ to: lp, amount: 50000 });
    await allTokens.approve({ to: vault, from: lp });
  });

  describe('pool creation', () => {
    it('any account can create pools', async () => {
      const receipt = await (await vault.connect(other).registerPool(PoolSpecialization.GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolRegistered', {
        poolAddress: other.address,
        specialization: PoolSpecialization.GeneralPool,
      });

      const poolId = event.args.poolId;
      expect(poolId).to.not.be.undefined;
    });

    it('pools require a valid pool specialization setting', async () => {
      // The existing pool specialization settings are general, minimal swap info and two tokens (0, 1 and 2)
      await expect(vault.connect(other).registerPool(3)).to.be.reverted;
    });
  });

  describe('pool properties', () => {
    let poolId: string;

    sharedBeforeEach(async () => {
      const receipt = await (await vault.connect(other).registerPool(PoolSpecialization.GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolRegistered');
      poolId = event.args.poolId;
    });

    it('has an address and an specialization setting', async () => {
      expect(await vault.getPool(poolId)).to.deep.equal([other.address, PoolSpecialization.GeneralPool]);
    });

    it('starts with no tokens', async () => {
      const { tokens, balances, lastChangeBlock } = await vault.getPoolTokens(poolId);
      expect(tokens).to.be.empty;
      expect(balances).to.be.empty;
      expect(lastChangeBlock).to.equal(0);
    });

    it('gets a new id', async () => {
      const receipt = await (await vault.connect(other).registerPool(PoolSpecialization.GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolRegistered', {
        poolAddress: other.address,
        specialization: PoolSpecialization.GeneralPool,
      });

      const otherPoolId = event.args.poolId;
      expect(poolId).to.not.equal(otherPoolId);
    });
  });

  describe('token management', () => {
    function itManagesPoolQueriesCorrectly(specialization: PoolSpecialization) {
      let poolId: string;

      sharedBeforeEach(async () => {
        const receipt = await (await vault.connect(other).registerPool(specialization)).wait();

        const event = expectEvent.inReceipt(receipt, 'PoolRegistered');
        poolId = event.args.poolId;

        const assetManagers = [ZERO_ADDRESS, ZERO_ADDRESS];

        await vault
          .connect(other)
          .registerTokens(poolId, [allTokens.DAI.address, allTokens.MKR.address], assetManagers);
      });

      it('reverts when querying token balances of unexisting pools', async () => {
        await expect(vault.getPoolTokens(ZERO_BYTES32)).to.be.revertedWith('INVALID_POOL_ID');
      });
    }

    describe('with general pool', () => {
      itManagesPoolQueriesCorrectly(PoolSpecialization.GeneralPool);
    });

    describe('with minimal swap info pool', () => {
      itManagesPoolQueriesCorrectly(PoolSpecialization.MinimalSwapInfoPool);
    });

    describe('with two token pool', () => {
      itManagesPoolQueriesCorrectly(PoolSpecialization.TwoTokenPool);
    });
  });

  describe('token registration', () => {
    // These tests use a MockPool contract instead of an EOA, since we need some of the hooks (such as onJoinPool)
    let pool: Contract;
    let poolId: string;
    let tokens: TokenList;
    let assetManagers: string[] = [];

    const setTokensAddresses = (length: number) => {
      beforeEach('define token addresses', () => {
        tokens = allTokens.subset(length);
        assetManagers = Array(length).fill(ZERO_ADDRESS);
      });
    };

    describe('register', () => {
      const itHandlesTokensRegistrationProperly = (specialization: PoolSpecialization) => {
        context('when the pool was created', () => {
          sharedBeforeEach('create pool', async () => {
            pool = await deploy('MockPool', { args: [vault.address, specialization] });
            poolId = await pool.getPoolId();
          });

          context('when the sender is the pool', () => {
            context('when the given addresses where not registered yet', () => {
              context('when one of the given tokens is the zero address', () => {
                setTokensAddresses(2);

                it('reverts', async () => {
                  const addresses = tokens.addresses;
                  addresses[0] = ZERO_ADDRESS;

                  const error = 'INVALID_TOKEN';
                  await expect(pool.registerTokens(addresses, assetManagers)).to.be.revertedWith(error);
                  await expect(pool.registerTokens(addresses.reverse(), assetManagers)).to.be.revertedWith(error);
                });
              });

              context('when the number of tokens and asset managers does not match', () => {
                setTokensAddresses(2);

                it('reverts', async () => {
                  await expect(pool.registerTokens(tokens.addresses, assetManagers.slice(1))).to.be.revertedWith(
                    'INPUT_LENGTH_MISMATCH'
                  );

                  await expect(
                    pool.registerTokens(tokens.addresses, assetManagers.concat(assetManagers[0]))
                  ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
                });
              });

              context('when none of the tokens is the zero address', () => {
                const itRegistersTheTokens = () => {
                  it('registers the requested tokens', async () => {
                    await pool.registerTokens(tokens.addresses, assetManagers);

                    const { tokens: poolTokens, balances, lastChangeBlock } = await vault.getPoolTokens(poolId);
                    expect(poolTokens).to.have.members(tokens.addresses);
                    expect(balances).to.deep.equal(Array(tokens.length).fill(bn(0)));
                    expect(lastChangeBlock).to.equal(0); // The token balance has not changed yet
                  });

                  it('emits an event', async () => {
                    const receipt = await (await pool.registerTokens(tokens.addresses, assetManagers)).wait();

                    expectEvent.inIndirectReceipt(receipt, vault.interface, 'TokensRegistered', {
                      poolId,
                      tokens: tokens.addresses,
                      assetManagers,
                    });
                  });

                  if (specialization == PoolSpecialization.TwoTokenPool) {
                    it('cannot be registered individually', async () => {
                      const error = 'TOKENS_LENGTH_MUST_BE_2';
                      await expect(pool.registerTokens([tokens.first.address], [assetManagers[0]])).to.be.revertedWith(
                        error
                      );
                    });
                  } else {
                    it('can be registered individually', async () => {
                      await tokens.asyncEach((token) => pool.registerTokens([token.address], [ZERO_ADDRESS]));

                      const { tokens: poolTokens, balances, lastChangeBlock } = await vault.getPoolTokens(poolId);
                      expect(poolTokens).to.have.members(tokens.addresses);
                      expect(balances).to.deep.equal(Array(tokens.length).fill(bn(0)));
                      expect(lastChangeBlock).to.equal(0);
                    });
                  }
                };

                const itRevertsDueToTwoTokens = () => {
                  it('reverts', async () => {
                    const error = 'TOKENS_LENGTH_MUST_BE_2';
                    await expect(pool.registerTokens(tokens.addresses, assetManagers)).to.be.revertedWith(error);
                  });
                };

                context('with one token', () => {
                  setTokensAddresses(1);
                  specialization === PoolSpecialization.TwoTokenPool
                    ? itRevertsDueToTwoTokens()
                    : itRegistersTheTokens();
                });

                context('with two tokens', () => {
                  setTokensAddresses(2);
                  itRegistersTheTokens();
                });

                context('with three tokens', () => {
                  setTokensAddresses(3);
                  specialization === PoolSpecialization.TwoTokenPool
                    ? itRevertsDueToTwoTokens()
                    : itRegistersTheTokens();
                });
              });
            });

            context('when one of the given tokens was already registered', () => {
              setTokensAddresses(2);

              sharedBeforeEach('register tokens', async () => {
                await pool.registerTokens(tokens.addresses, assetManagers);
              });

              it('reverts', async () => {
                const error =
                  specialization == PoolSpecialization.TwoTokenPool ? 'TOKENS_ALREADY_SET' : 'TOKEN_ALREADY_REGISTERED';
                await expect(pool.registerTokens(tokens.addresses, assetManagers)).to.be.revertedWith(error);
              });
            });
          });

          context('when the sender is not the pool', () => {
            it('reverts', async () => {
              await expect(
                vault.connect(other).registerTokens(poolId, tokens.addresses, assetManagers)
              ).to.be.revertedWith('CALLER_NOT_POOL');
            });
          });
        });

        context('when the pool was not created', () => {
          it('reverts', async () => {
            await expect(vault.registerTokens(ZERO_BYTES32, tokens.addresses, assetManagers)).to.be.revertedWith(
              'INVALID_POOL_ID'
            );
          });
        });
      };

      context('for a minimal swap info pool', () => {
        itHandlesTokensRegistrationProperly(PoolSpecialization.MinimalSwapInfoPool);
      });

      context('for a general pool', () => {
        itHandlesTokensRegistrationProperly(PoolSpecialization.GeneralPool);
      });

      context('for a two token pool', () => {
        itHandlesTokensRegistrationProperly(PoolSpecialization.TwoTokenPool);
      });
    });

    describe('deregister', () => {
      const itHandlesTokensDeregistrationProperly = (specialization: PoolSpecialization) => {
        context('when the pool was created', () => {
          sharedBeforeEach('create pool', async () => {
            pool = await deploy('MockPool', { args: [vault.address, specialization] });
            poolId = await pool.getPoolId();
          });

          context('when the sender is the pool', () => {
            context('when the given addresses where registered', () => {
              const itDeregistersTheTokens = () => {
                sharedBeforeEach('register tokens', async () => {
                  await pool.registerTokens(tokens.addresses, assetManagers);
                });

                context('when some tokens still have some balance', () => {
                  sharedBeforeEach('add some balance', async () => {
                    await vault.connect(lp).joinPool(poolId, lp.address, other.address, {
                      assets: tokens.addresses,
                      maxAmountsIn: Array(tokens.length).fill(MAX_UINT256),
                      fromInternalBalance: false,
                      userData: encodeJoin(Array(tokens.length).fill(5), Array(tokens.length).fill(0)),
                    });
                  });

                  context('when trying to deregister individually', () => {
                    if (specialization == PoolSpecialization.TwoTokenPool) {
                      it('reverts', async () => {
                        const error = 'TOKENS_LENGTH_MUST_BE_2';
                        await expect(pool.deregisterTokens([tokens.first.address])).to.be.revertedWith(error);
                      });
                    } else {
                      it('can deregister the tokens without balance', async () => {
                        await vault.connect(lp).exitPool(poolId, lp.address, other.address, {
                          assets: tokens.addresses,
                          minAmountsOut: Array(tokens.length).fill(0),
                          toInternalBalance: false,
                          userData: encodeExit(
                            tokens.addresses.map((_, index) => (index == 0 ? 5 : 0)), // Fully exit on token 0
                            Array(tokens.length).fill(0)
                          ),
                        });

                        const exitBlock = await lastBlockNumber();

                        await pool.deregisterTokens([tokens.first.address]);

                        const { tokens: poolTokens, lastChangeBlock } = await vault.getPoolTokens(poolId);
                        expect(poolTokens).not.to.have.members([tokens.first.address]);

                        // If all tokens are deregisted, the last change block goes back to the initial value.
                        const expectedBlock = poolTokens.length > 0 ? exitBlock : 0;
                        expect(lastChangeBlock).to.equal(expectedBlock);
                      });
                    }
                  });

                  context('when trying to deregister all tokens at once', () => {
                    it('reverts', async () => {
                      const error = 'NONZERO_TOKEN_BALANCE';
                      await expect(pool.deregisterTokens(tokens.addresses)).to.be.revertedWith(error);
                    });
                  });
                });

                context('when all the tokens have no balance', () => {
                  it('deregisters the requested tokens', async () => {
                    await pool.deregisterTokens(tokens.addresses);

                    const { tokens: poolTokens, balances, lastChangeBlock } = await vault.getPoolTokens(poolId);
                    expect(poolTokens).to.be.empty;
                    expect(balances).to.be.empty;
                    expect(lastChangeBlock).to.equal(0);
                  });

                  it('cannot query balances any more', async () => {
                    await pool.deregisterTokens(tokens.addresses);

                    const { tokens: poolTokens, balances, lastChangeBlock } = await vault.getPoolTokens(poolId);
                    expect(poolTokens).to.be.empty;
                    expect(balances).to.be.empty;
                    expect(lastChangeBlock).to.equal(0);
                  });

                  it('emits an event', async () => {
                    const receipt = await (await pool.deregisterTokens(tokens.addresses)).wait();
                    expectEvent.inIndirectReceipt(receipt, vault.interface, 'TokensDeregistered', {
                      poolId,
                      tokens: tokens.addresses,
                    });
                  });
                });
              };

              const itRevertsDueToTwoTokens = () => {
                it('reverts', async () => {
                  const error = 'TOKENS_LENGTH_MUST_BE_2';
                  await expect(pool.deregisterTokens(tokens.addresses)).to.be.revertedWith(error);
                });
              };

              context('with one token', () => {
                setTokensAddresses(1);
                specialization === PoolSpecialization.TwoTokenPool
                  ? itRevertsDueToTwoTokens()
                  : itDeregistersTheTokens();
              });

              context('with two tokens', () => {
                setTokensAddresses(2);
                itDeregistersTheTokens();
              });

              context('with three tokens', () => {
                setTokensAddresses(3);
                specialization === PoolSpecialization.TwoTokenPool
                  ? itRevertsDueToTwoTokens()
                  : itDeregistersTheTokens();
              });
            });

            context('when one of the given addresses was not registered', () => {
              setTokensAddresses(2);

              it('reverts', async () => {
                const error = 'TOKEN_NOT_REGISTERED';
                await expect(pool.deregisterTokens(tokens.addresses)).to.be.revertedWith(error);
              });
            });
          });

          context('when the sender is not the pool', () => {
            it('reverts', async () => {
              await expect(vault.connect(other).deregisterTokens(poolId, tokens.addresses)).to.be.revertedWith(
                'CALLER_NOT_POOL'
              );
            });
          });
        });

        context('when the pool was not created', () => {
          it('reverts', async () => {
            await expect(vault.deregisterTokens(ZERO_BYTES32, tokens.addresses)).to.be.revertedWith('INVALID_POOL_ID');
          });
        });
      };

      context('for a minimal swap info pool', () => {
        itHandlesTokensDeregistrationProperly(PoolSpecialization.MinimalSwapInfoPool);
      });

      context('for a general pool', () => {
        itHandlesTokensDeregistrationProperly(PoolSpecialization.GeneralPool);
      });

      context('for a two token pool', () => {
        itHandlesTokensDeregistrationProperly(PoolSpecialization.TwoTokenPool);
      });
    });
  });
});
