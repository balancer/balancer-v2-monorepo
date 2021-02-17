import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import * as expectEvent from '../helpers/expectEvent';
import { bn } from '../../lib/helpers/numbers';
import { deploy } from '../../lib/helpers/deploy';
import { deployTokens, mintTokens, TokenList } from '../../lib/helpers/tokens';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '../../lib/helpers/constants';
import { PoolSpecializationSetting, MinimalSwapInfoPool, GeneralPool, TwoTokenPool } from '../../lib/helpers/pools';
import { encodeExit, encodeJoin } from '../helpers/mockPool';
import { sharedBeforeEach } from '../helpers/lib/sharedBeforeEach';

let admin: SignerWithAddress;
let lp: SignerWithAddress;
let other: SignerWithAddress;

let authorizer: Contract;
let vault: Contract;
let symbols: string[];
let tokens: TokenList = {};

describe('Vault - pool registry', () => {
  before(async () => {
    [, admin, lp, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });
    symbols = ['DAI', 'MKR', 'SNX'];
    tokens = await deployTokens(symbols, [18, 18, 18]);

    for (const symbol in tokens) {
      // Mint tokens for the lp to deposit in the Vault
      await mintTokens(tokens, symbol, lp, 50000);
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);
    }
  });

  describe('pool creation', () => {
    it('any account can create pools', async () => {
      const receipt = await (await vault.connect(other).registerPool(GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
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
      const receipt = await (await vault.connect(other).registerPool(GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      poolId = event.args.poolId;
    });

    it('has an address and an specialization setting', async () => {
      expect(await vault.getPool(poolId)).to.deep.equal([other.address, GeneralPool]);
    });

    it('starts with no tokens', async () => {
      const { tokens, balances } = await vault.getPoolTokens(poolId);
      expect(tokens).to.be.empty;
      expect(balances).to.be.empty;
    });

    it('gets a new id', async () => {
      const receipt = await (await vault.connect(other).registerPool(GeneralPool)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      const otherPoolId = event.args.poolId;

      expect(poolId).to.not.equal(otherPoolId);
    });
  });

  describe('token management', () => {
    function itManagesPoolQueriesCorrectly(specialization: PoolSpecializationSetting) {
      let poolId: string;

      sharedBeforeEach(async () => {
        const receipt = await (await vault.connect(other).registerPool(specialization)).wait();

        const event = expectEvent.inReceipt(receipt, 'PoolCreated');
        poolId = event.args.poolId;

        const assetManagers = [ZERO_ADDRESS, ZERO_ADDRESS];

        await vault.connect(other).registerTokens(poolId, [tokens.DAI.address, tokens.MKR.address], assetManagers);
      });

      it('reverts when querying token balances of unexisting pools', async () => {
        await expect(vault.getPoolTokens(ZERO_BYTES32)).to.be.revertedWith('INVALID_POOL_ID');
      });
    }

    describe('with general pool', () => {
      itManagesPoolQueriesCorrectly(GeneralPool);
    });

    describe('with minimal swap info pool', () => {
      itManagesPoolQueriesCorrectly(MinimalSwapInfoPool);
    });

    describe('with two token pool', () => {
      itManagesPoolQueriesCorrectly(TwoTokenPool);
    });
  });

  describe('token registration', () => {
    // These tests use a MockPool contract instead of an EOA, since we need some of the hooks (such as onJoinPool)
    let pool: Contract;
    let poolId: string;
    let tokenAddresses: string[] = [];
    let assetManagers: string[] = [];

    const setTokensAddresses = (length: number) => {
      beforeEach('define token addresses', () => {
        tokenAddresses = symbols
          .slice(0, length)
          .map((symbol: string) => tokens[symbol].address)
          .sort((tokenA, tokenB) => (tokenA.toLowerCase() > tokenB.toLowerCase() ? 1 : -1));

        assetManagers = symbols.slice(0, length).map(() => ZERO_ADDRESS);
      });
    };

    describe('register', () => {
      const itHandlesTokensRegistrationProperly = (specialization: PoolSpecializationSetting) => {
        context('when the pool was created', () => {
          sharedBeforeEach('create pool', async () => {
            pool = await deploy('MockPool', { args: [vault.address, specialization] });
            poolId = await pool.getPoolId();
          });

          context('when the sender is the pool', () => {
            context('when the given addresses where not registered yet', () => {
              context('when one of the given tokens is the zero address', () => {
                beforeEach('update token list to use zero address', () => {
                  tokenAddresses[0] = ZERO_ADDRESS;
                  tokenAddresses[1] = tokens['DAI'].address;
                });

                it('reverts', async () => {
                  const error = 'ZERO_ADDRESS_TOKEN';
                  await expect(pool.registerTokens(tokenAddresses, assetManagers)).to.be.revertedWith(error);
                  await expect(pool.registerTokens(tokenAddresses.reverse(), assetManagers)).to.be.revertedWith(error);
                });
              });

              context('when none of the tokens is the zero address', () => {
                const itRegistersTheTokens = () => {
                  it('registers the requested tokens', async () => {
                    await pool.registerTokens(tokenAddresses, assetManagers);

                    const { tokens, balances } = await vault.getPoolTokens(poolId);
                    expect(tokens).to.have.members(tokenAddresses);
                    expect(balances).to.deep.equal(Array(tokenAddresses.length).fill(bn(0)));
                  });

                  it('emits an event', async () => {
                    const receipt = await (await pool.registerTokens(tokenAddresses, assetManagers)).wait();

                    expectEvent.inIndirectReceipt(receipt, vault.interface, 'TokensRegistered', {
                      poolId,
                      tokens: tokenAddresses,
                      assetManagers,
                    });
                  });

                  if (specialization == TwoTokenPool) {
                    it('cannot be registered individually', async () => {
                      const error = 'TOKENS_LENGTH_MUST_BE_2';
                      await expect(pool.registerTokens([tokenAddresses[0]], [assetManagers[0]])).to.be.revertedWith(
                        error
                      );
                    });
                  } else {
                    it('can be registered individually', async () => {
                      for (const tokenAddress of tokenAddresses) {
                        await pool.registerTokens([tokenAddress], [ZERO_ADDRESS]);
                      }

                      const { tokens, balances } = await vault.getPoolTokens(poolId);
                      expect(tokens).to.have.members(tokenAddresses);
                      expect(balances).to.deep.equal(Array(tokenAddresses.length).fill(bn(0)));
                    });
                  }
                };

                const itRevertsDueToTwoTokens = () => {
                  it('reverts', async () => {
                    const error = 'TOKENS_LENGTH_MUST_BE_2';
                    await expect(pool.registerTokens(tokenAddresses, assetManagers)).to.be.revertedWith(error);
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

              sharedBeforeEach('register tokens', async () => {
                await pool.registerTokens(tokenAddresses, assetManagers);
              });

              it('reverts', async () => {
                const error = specialization == TwoTokenPool ? 'TOKENS_ALREADY_SET' : 'TOKEN_ALREADY_REGISTERED';
                await expect(pool.registerTokens(tokenAddresses, assetManagers)).to.be.revertedWith(error);
              });
            });
          });

          context('when the sender is not the pool', () => {
            it('reverts', async () => {
              await expect(
                vault.connect(other).registerTokens(poolId, tokenAddresses, assetManagers)
              ).to.be.revertedWith('CALLER_NOT_POOL');
            });
          });
        });

        context('when the pool was not created', () => {
          it('reverts', async () => {
            await expect(vault.registerTokens(ZERO_BYTES32, tokenAddresses, assetManagers)).to.be.revertedWith(
              'INVALID_POOL_ID'
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

    describe('deregister', () => {
      const itHandlesTokensDeregistrationProperly = (specialization: PoolSpecializationSetting) => {
        context('when the pool was created', () => {
          sharedBeforeEach('create pool', async () => {
            pool = await deploy('MockPool', { args: [vault.address, specialization] });
            poolId = await pool.getPoolId();
          });

          context('when the sender is the pool', () => {
            context('when the given addresses where registered', () => {
              const itDeregistersTheTokens = () => {
                sharedBeforeEach('register tokens', async () => {
                  await pool.registerTokens(tokenAddresses, assetManagers);
                });

                context('when some tokens still have some balance', () => {
                  sharedBeforeEach('add some balance', async () => {
                    await vault.connect(lp).joinPool(
                      poolId,
                      lp.address,
                      other.address,
                      tokenAddresses,
                      tokenAddresses.map(() => MAX_UINT256),
                      false,
                      encodeJoin(
                        tokenAddresses.map(() => 5),
                        tokenAddresses.map(() => 0)
                      )
                    );
                  });

                  context('when trying to deregister individually', () => {
                    if (specialization == TwoTokenPool) {
                      it('reverts', async () => {
                        const error = 'TOKENS_LENGTH_MUST_BE_2';
                        await expect(pool.deregisterTokens([tokenAddresses[0]])).to.be.revertedWith(error);
                      });
                    } else {
                      it('can deregister the tokens without balance', async () => {
                        await vault.connect(lp).exitPool(
                          poolId,
                          lp.address,
                          other.address,
                          tokenAddresses,
                          tokenAddresses.map(() => 0),
                          false,
                          encodeExit(
                            tokenAddresses.map((_, index) => (index == 0 ? 5 : 0)), // Fully exit on token 0
                            tokenAddresses.map(() => 0)
                          )
                        );

                        await pool.deregisterTokens([tokenAddresses[0]]);

                        const { tokens: poolTokens } = await vault.getPoolTokens(poolId);
                        expect(poolTokens).not.to.have.members([tokenAddresses[0]]);
                      });
                    }
                  });

                  context('when trying to deregister all tokens at once', () => {
                    it('reverts', async () => {
                      const error = 'NONZERO_TOKEN_BALANCE';
                      await expect(pool.deregisterTokens(tokenAddresses)).to.be.revertedWith(error);
                    });
                  });
                });

                context('when all the tokens have no balance', () => {
                  it('deregisters the requested tokens', async () => {
                    await pool.deregisterTokens(tokenAddresses);

                    const { tokens: poolTokens, balances } = await vault.getPoolTokens(poolId);
                    expect(poolTokens).to.be.empty;
                    expect(balances).to.be.empty;
                  });

                  it('cannot query balances any more', async () => {
                    await pool.deregisterTokens(tokenAddresses);

                    const { tokens, balances } = await vault.getPoolTokens(poolId);
                    expect(tokens).to.be.empty;
                    expect(balances).to.be.empty;
                  });

                  it('emits an event', async () => {
                    const receipt = await (await pool.deregisterTokens(tokenAddresses)).wait();
                    expectEvent.inIndirectReceipt(receipt, vault.interface, 'TokensDeregistered', {
                      poolId,
                      tokens: tokenAddresses,
                    });
                  });
                });
              };

              const itRevertsDueToTwoTokens = () => {
                it('reverts', async () => {
                  const error = 'TOKENS_LENGTH_MUST_BE_2';
                  await expect(pool.deregisterTokens(tokenAddresses)).to.be.revertedWith(error);
                });
              };

              context('with one token', () => {
                setTokensAddresses(1);
                specialization === TwoTokenPool ? itRevertsDueToTwoTokens() : itDeregistersTheTokens();
              });

              context('with two tokens', () => {
                setTokensAddresses(2);
                itDeregistersTheTokens();
              });

              context('with three tokens', () => {
                setTokensAddresses(3);
                specialization === TwoTokenPool ? itRevertsDueToTwoTokens() : itDeregistersTheTokens();
              });
            });

            context('when one of the given addresses was not registered', () => {
              setTokensAddresses(2);

              it('reverts', async () => {
                const error = 'TOKEN_NOT_REGISTERED';
                await expect(pool.deregisterTokens(tokenAddresses)).to.be.revertedWith(error);
              });
            });
          });

          context('when the sender is not the pool', () => {
            it('reverts', async () => {
              await expect(vault.connect(other).deregisterTokens(poolId, tokenAddresses)).to.be.revertedWith(
                'CALLER_NOT_POOL'
              );
            });
          });
        });

        context('when the pool was not created', () => {
          it('reverts', async () => {
            await expect(vault.deregisterTokens(ZERO_BYTES32, tokenAddresses)).to.be.revertedWith('INVALID_POOL_ID');
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
});
