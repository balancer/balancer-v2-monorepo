import { times } from 'lodash';
import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '../helpers/models/tokens/Token';
import TokenList from '../helpers/models/tokens/TokenList';
import * as expectEvent from '../helpers/expectEvent';
import { encodeJoin } from '../helpers/mockPool';
import { expectBalanceChange } from '../helpers/tokenBalance';

import { deploy } from '../../lib/helpers/deploy';
import { roleId } from '../../lib/helpers/roles';
import { MAX_UINT256, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { arraySub, bn, BigNumberish, min, fp } from '../../lib/helpers/numbers';
import { PoolSpecializationSetting, MinimalSwapInfoPool, GeneralPool, TwoTokenPool } from '../../lib/helpers/pools';
import { sharedBeforeEach } from '../helpers/lib/sharedBeforeEach';

describe('Vault - join pool', () => {
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress, relayer: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let allTokens: TokenList;

  before(async () => {
    [, admin, creator, lp, relayer] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    const role = roleId(vault, 'setProtocolFees');
    await authorizer.connect(admin).grantRole(role, admin.address);
    await vault.connect(admin).setProtocolFees(fp(0.1), 0, 0);

    allTokens = await TokenList.create(['DAI', 'MKR', 'SNX', 'BAT'], { sorted: true });
    await allTokens.mint({ to: [creator, lp], amount: bn(100e18) });
    await allTokens.approve({ to: vault, from: [creator, lp] });
  });

  describe('with general pool', () => {
    itJoinsSpecializedPoolCorrectly(GeneralPool, 4);
  });

  describe('with minimal swap info pool', () => {
    itJoinsSpecializedPoolCorrectly(MinimalSwapInfoPool, 3);
  });

  describe('with two token pool', () => {
    itJoinsSpecializedPoolCorrectly(TwoTokenPool, 2);
  });

  function itJoinsSpecializedPoolCorrectly(specialization: PoolSpecializationSetting, tokenAmount: number) {
    let pool: Contract;
    let poolId: string;
    let tokens: TokenList;

    let joinAmounts: BigNumber[];
    let DUE_PROTOCOL_FEE_AMOUNTS: BigNumber[];

    function array(value: BigNumberish): BigNumber[] {
      return Array(tokenAmount).fill(bn(value));
    }

    sharedBeforeEach('deploy & register pool', async () => {
      pool = await deploy('MockPool', { args: [vault.address, specialization] });
      poolId = await pool.getPoolId();
      tokens = await allTokens.subset(tokenAmount);

      await pool.registerTokens(tokens.addresses, Array(tokenAmount).fill(ZERO_ADDRESS));

      joinAmounts = tokens.addresses.map((_, i) => bn(1e18).mul(i + 1));
      DUE_PROTOCOL_FEE_AMOUNTS = array(0);

      // Join the Pool from the creator so that it has some tokens to pay protocol fees with
      await vault
        .connect(creator)
        .joinPool(
          poolId,
          creator.address,
          ZERO_ADDRESS,
          tokens.addresses,
          array(MAX_UINT256),
          false,
          encodeJoin(array(50e18), array(0))
        );
    });

    type JoinPoolData = {
      poolId?: string;
      tokenAddresses?: string[];
      maxAmountsIn?: BigNumberish[];
      fromInternalBalance?: boolean;
      joinAmounts?: BigNumberish[];
      dueProtocolFeeAmounts?: BigNumberish[];
      fromRelayer?: boolean;
    };

    function joinPool(data: JoinPoolData): Promise<ContractTransaction> {
      return vault
        .connect(data.fromRelayer ?? false ? relayer : lp)
        .joinPool(
          data.poolId ?? poolId,
          lp.address,
          ZERO_ADDRESS,
          data.tokenAddresses ?? tokens.addresses,
          data.maxAmountsIn ?? array(MAX_UINT256),
          data.fromInternalBalance ?? false,
          encodeJoin(data.joinAmounts ?? joinAmounts, data.dueProtocolFeeAmounts ?? DUE_PROTOCOL_FEE_AMOUNTS)
        );
    }

    context('when called incorrectly', () => {
      it('reverts if the pool ID does not exist', async () => {
        await expect(joinPool({ poolId: ethers.utils.id('invalid') })).to.be.revertedWith('INVALID_POOL_ID');
      });

      it('reverts if token array is incorrect', async () => {
        // Missing - token addresses and max amounts min length must match
        await expect(
          joinPool({ tokenAddresses: tokens.addresses.slice(1), maxAmountsIn: array(0).slice(1) })
        ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

        // Extra  - token addresses and max amounts min length must match
        await expect(
          joinPool({
            tokenAddresses: tokens.addresses.concat(tokens.first.address),
            maxAmountsIn: array(0).concat(bn(0)),
          })
        ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

        // Unordered
        await expect(joinPool({ tokenAddresses: tokens.addresses.reverse() })).to.be.revertedWith('TOKENS_MISMATCH');
      });

      it('reverts if tokens and amounts length do not match', async () => {
        await expect(joinPool({ maxAmountsIn: array(0).slice(1) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        await expect(joinPool({ maxAmountsIn: array(0).concat(bn(0)) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
      });
    });

    context('when called correctly', () => {
      context('with incorrect pool return values', () => {
        it('reverts if join amounts length does not match token length', async () => {
          // Missing
          await expect(joinPool({ joinAmounts: array(0).slice(1) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

          // Extra
          await expect(joinPool({ joinAmounts: array(0).concat(bn(0)) })).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });

        it('reverts if due protocol fees length does not match token length', async () => {
          // Missing
          await expect(joinPool({ dueProtocolFeeAmounts: array(0).slice(1) })).to.be.revertedWith(
            'INPUT_LENGTH_MISMATCH'
          );

          // Extra
          await expect(joinPool({ dueProtocolFeeAmounts: array(0).concat(bn(0)) })).to.be.revertedWith(
            'INPUT_LENGTH_MISMATCH'
          );
        });

        it('reverts if join amounts and due protocol fees length do not match token length', async () => {
          // Missing
          await expect(
            joinPool({ joinAmounts: array(0).slice(1), dueProtocolFeeAmounts: array(0).slice(1) })
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');

          // Extra
          await expect(
            joinPool({ joinAmounts: array(0).concat(bn(0)), dueProtocolFeeAmounts: array(0).concat(bn(0)) })
          ).to.be.revertedWith('INPUT_LENGTH_MISMATCH');
        });
      });

      context('with correct pool return values', () => {
        context('with no due protocol fees', () => {
          const dueProtocolFeeAmounts = array(0);

          context('when the sender is the user', () => {
            const fromRelayer = false;

            itJoinsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
          });

          context('when the sender is a relayer', () => {
            const fromRelayer = true;

            context('when the relayer is whitelisted by the authorizer', () => {
              sharedBeforeEach('grant role to relayer', async () => {
                const role = roleId(vault, 'joinPool');
                await authorizer.connect(admin).grantRole(role, relayer.address);
              });

              context('when the relayer is allowed by the user', () => {
                sharedBeforeEach('allow relayer', async () => {
                  await vault.connect(lp).changeRelayerAllowance(relayer.address, true);
                });

                itJoinsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
              });

              context('when the relayer is not allowed by the user', () => {
                sharedBeforeEach('disallow relayer', async () => {
                  await vault.connect(lp).changeRelayerAllowance(relayer.address, false);
                });

                it('reverts', async () => {
                  await expect(joinPool({ dueProtocolFeeAmounts, fromRelayer })).to.be.revertedWith(
                    'USER_DOESNT_ALLOW_RELAYER'
                  );
                });
              });
            });

            context('when the relayer is not whitelisted by the authorizer', () => {
              sharedBeforeEach('revoke role from relayer', async () => {
                const role = roleId(vault, 'batchSwapGivenIn');
                await authorizer.connect(admin).revokeRole(role, relayer.address);
              });

              context('when the relayer is allowed by the user', () => {
                sharedBeforeEach('allow relayer', async () => {
                  await vault.connect(lp).changeRelayerAllowance(relayer.address, true);
                });

                it('reverts', async () => {
                  await expect(joinPool({ dueProtocolFeeAmounts, fromRelayer })).to.be.revertedWith(
                    'SENDER_NOT_ALLOWED'
                  );
                });
              });

              context('when the relayer is not allowed by the user', () => {
                sharedBeforeEach('disallow relayer', async () => {
                  await vault.connect(lp).changeRelayerAllowance(relayer.address, false);
                });

                it('reverts', async () => {
                  await expect(joinPool({ dueProtocolFeeAmounts, fromRelayer })).to.be.revertedWith(
                    'SENDER_NOT_ALLOWED'
                  );
                });
              });
            });
          });
        });

        context('with due protocol fees', () => {
          const dueProtocolFeeAmounts = array(1e18);
          const fromRelayer = false;

          itJoinsCorrectlyWithAndWithoutInternalBalance(dueProtocolFeeAmounts, fromRelayer);
        });
      });
    });

    function itJoinsCorrectlyWithAndWithoutInternalBalance(
      dueProtocolFeeAmounts: BigNumberish[],
      fromRelayer: boolean
    ) {
      context('not using internal balance', () => {
        const fromInternalBalance = false;

        context('with no internal balance', () => {
          itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance);
        });

        context('with some internal balance', () => {
          sharedBeforeEach('deposit to internal balance', async () => {
            await vault.connect(lp).depositToInternalBalance(lp.address, tokens.addresses, array(1.5e18), lp.address);
          });

          itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance);
        });
      });

      context('using internal balance', () => {
        const fromInternalBalance = true;

        context('with no internal balance', () => {
          itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance);
        });

        context('with some internal balance', () => {
          sharedBeforeEach('deposit to internal balance', async () => {
            await vault.connect(lp).depositToInternalBalance(lp.address, tokens.addresses, array(1.5e18), lp.address);
          });

          itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance);
        });

        context('with enough internal balance', () => {
          sharedBeforeEach('deposit to internal balance', async () => {
            await vault.connect(lp).depositToInternalBalance(lp.address, tokens.addresses, array(100e18), lp.address);
          });

          itJoinsCorrectly(dueProtocolFeeAmounts, fromRelayer, fromInternalBalance);
        });
      });
    }

    function itJoinsCorrectly(
      dueProtocolFeeAmounts: BigNumberish[],
      fromRelayer: boolean,
      fromInternalBalance: boolean
    ) {
      let expectedInternalBalanceToUse: BigNumber[];

      sharedBeforeEach('calculate intermediate values', async () => {
        const currentInternalBalances: BigNumber[] = await vault.getInternalBalance(lp.address, tokens.addresses);

        expectedInternalBalanceToUse = currentInternalBalances.map((balance, i) =>
          // If withdrawing from internal balance, the amount to withdraw is limited by the lower of the current
          // balance and the actual join amount.
          fromInternalBalance ? min(balance, joinAmounts[i]) : bn(0)
        );
      });

      it('takes tokens from the LP into the vault', async () => {
        const expectedTransferAmounts = arraySub(joinAmounts, expectedInternalBalanceToUse);

        // Tokens are sent from the LP, so the expected change is negative
        const lpChanges = tokens.reduce(
          (changes, token, i) => ({ ...changes, [token.symbol]: expectedTransferAmounts[i].mul(-1) }),
          {}
        );

        // Tokens are sent to the Vault, so the expected change is positive
        const vaultChanges = tokens.reduce(
          (changes, token, i) => ({ ...changes, [token.symbol]: expectedTransferAmounts[i] }),
          {}
        );

        await expectBalanceChange(
          () => joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance }),
          allTokens,
          [
            { account: vault, changes: vaultChanges },
            { account: lp, changes: lpChanges },
          ]
        );
      });

      it('deducts internal balance from the LP', async () => {
        const previousInternalBalances = await vault.getInternalBalance(lp.address, tokens.addresses);
        await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance });
        const currentInternalBalances = await vault.getInternalBalance(lp.address, tokens.addresses);

        // Internal balance is expected to decrease: previous - current should equal expected.
        expect(arraySub(previousInternalBalances, currentInternalBalances)).to.deep.equal(expectedInternalBalanceToUse);
      });

      it('assigns tokens to the pool', async () => {
        const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
        await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance });
        const { balances: currentPoolBalances } = await vault.getPoolTokens(poolId);

        // The Pool balance is expected to increase by join amounts minus due protocol fees. Note that the deltas are
        // not necessarily positive, if the fees due are larger than the join amounts.
        expect(arraySub(currentPoolBalances, previousPoolBalances)).to.deep.equal(
          arraySub(joinAmounts, dueProtocolFeeAmounts)
        );
      });

      it('calls the pool with the join data', async () => {
        const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
        const { blockNumber: previousBlockNumber } = await vault.getPoolTokenInfo(poolId, tokens.first.address);

        const receipt = await (await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance })).wait();

        expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnJoinPoolCalled', {
          poolId,
          sender: lp.address,
          recipient: ZERO_ADDRESS,
          currentBalances: previousPoolBalances,
          latestBlockNumberUsed: previousBlockNumber,
          protocolSwapFee: (await vault.getProtocolFees()).swapFee,
          userData: encodeJoin(joinAmounts, dueProtocolFeeAmounts),
        });
      });

      it('updates the latest block number used for all tokens', async () => {
        const currentBlockNumber = Number(await network.provider.send('eth_blockNumber'));

        await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance });

        await tokens.forEach(async (token: Token) => {
          const { blockNumber: newBlockNumber } = await vault.getPoolTokenInfo(poolId, token.address);
          expect(newBlockNumber).to.equal(currentBlockNumber + 1);
        });
      });

      it('emits PoolJoined from the vault', async () => {
        const receipt = await (await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance })).wait();

        expectEvent.inReceipt(receipt, 'PoolJoined', {
          poolId,
          liquidityProvider: lp.address,
          amountsIn: joinAmounts,
          protocolFees: dueProtocolFeeAmounts,
        });
      });

      it('collects protocol fees', async () => {
        const previousCollectedFees: BigNumber[] = await tokens.map((token) => vault.getCollectedFees([token.address]));
        await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance });
        const currentCollectedFees: BigNumber[] = await tokens.map((token) => vault.getCollectedFees([token.address]));

        expect(arraySub(currentCollectedFees, previousCollectedFees)).to.deep.equal(dueProtocolFeeAmounts);
      });

      it('joins multiple times', async () => {
        await Promise.all(
          times(3, () => async () => {
            const receipt = await (await joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance })).wait();
            expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnJoinPoolCalled');
          })
        );
      });

      it('reverts if any of the max amounts in is not enough', async () => {
        await Promise.all(
          joinAmounts.map((amount, i) => {
            if (amount.gt(0)) {
              const maxAmountsIn = array(MAX_UINT256);
              maxAmountsIn[i] = amount.sub(1);

              return expect(
                joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance, maxAmountsIn })
              ).to.be.revertedWith('JOIN_ABOVE_MAX');
            }
          })
        );
      });

      it('reverts if any of the amounts to transfer is larger than lp balance', async () => {
        const expectedTokensToTransfer = arraySub(joinAmounts, expectedInternalBalanceToUse);

        await tokens.forEach(async (token: Token, i: number) => {
          const amount = expectedTokensToTransfer[i];
          if (amount.gt(0)) {
            // Burn excess balance so that the LP is missing one token to join
            const currentBalance = await token.balanceOf(lp.address);
            await token.burn(currentBalance.sub(amount).add(1), { from: lp });

            return expect(joinPool({ dueProtocolFeeAmounts, fromRelayer, fromInternalBalance })).to.be.revertedWith(
              'ERC20: transfer amount exceeds balance'
            );
          }
        });
      });
    }
  }
});
