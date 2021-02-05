import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { MAX_UINT256, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { deploySortedTokens, mintTokens, TokenList } from '../../lib/helpers/tokens';
import { PoolSpecializationSetting, MinimalSwapInfoPool, GeneralPool, TwoTokenPool } from '../../lib/helpers/pools';
import { arraySub, bn, BigNumberish, min, fp } from '../../lib/helpers/numbers';
import { expectBalanceChange } from '../helpers/tokenBalance';
import * as expectEvent from '../helpers/expectEvent';
import { times } from 'lodash';
import { encodeJoin } from '../helpers/mockPool';

describe('Vault - join pool', () => {
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList = {};

  let TOKEN_ADDRESSES: string[];

  before(async () => {
    [, admin, creator, lp] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_FEES_ROLE(), admin.address);
    await vault.connect(admin).setProtocolFees(fp(0.1), 0, 0);

    tokens = await deploySortedTokens(['DAI', 'MKR', 'SNX', 'BAT'], [18, 18, 18, 18]);
    TOKEN_ADDRESSES = [];

    for (const symbol in tokens) {
      // Mint tokens for the creator to create the Pool
      await mintTokens(tokens, symbol, creator, bn(100e18));
      await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

      // Mint tokens for the lp to join the Pool
      await mintTokens(tokens, symbol, lp, bn(100e18));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      TOKEN_ADDRESSES.push(tokens[symbol].address);
    }
  });

  function symbol(tokenAddress: string): string {
    for (const symbol in tokens) {
      if (tokens[symbol].address === tokenAddress) {
        return symbol;
      }
    }

    throw new Error(`Symbol for token ${tokenAddress} not found`);
  }

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

    let tokenAddresses: string[];

    let joinAmounts: BigNumber[];
    let dueProtocolFeeAmounts: BigNumber[];

    function array(value: BigNumberish): BigNumber[] {
      return Array(tokenAmount).fill(bn(value));
    }

    beforeEach('deploy & register pool', async () => {
      pool = await deploy('MockPool', { args: [vault.address, specialization] });
      poolId = await pool.getPoolId();

      tokenAddresses = TOKEN_ADDRESSES.slice(0, tokenAmount);
      await pool.registerTokens(tokenAddresses, Array(tokenAmount).fill(ZERO_ADDRESS));

      joinAmounts = tokenAddresses.map((_, i) => bn(1e18).mul(i + 1));
      dueProtocolFeeAmounts = array(0);

      // Join the Pool from the creator so that it has some tokens to pay protocol fees with
      await vault
        .connect(creator)
        .joinPool(poolId, ZERO_ADDRESS, tokenAddresses, array(MAX_UINT256), false, encodeJoin(array(50e18), array(0)));
    });

    type JoinPoolData = {
      poolId?: string;
      tokenAddresses?: string[];
      maxAmountsIn?: BigNumberish[];
      fromInternalBalance?: boolean;
      joinAmounts?: BigNumberish[];
      dueProtocolFeeAmounts?: BigNumberish[];
    };

    function joinPool(data: JoinPoolData): Promise<ContractTransaction> {
      return vault
        .connect(lp)
        .joinPool(
          data.poolId ?? poolId,
          ZERO_ADDRESS,
          data.tokenAddresses ?? tokenAddresses,
          data.maxAmountsIn ?? array(MAX_UINT256),
          data.fromInternalBalance ?? false,
          encodeJoin(data.joinAmounts ?? joinAmounts, data.dueProtocolFeeAmounts ?? dueProtocolFeeAmounts)
        );
    }

    context('when called incorrectly', () => {
      it('reverts if the pool ID does not exist', async () => {
        await expect(joinPool({ poolId: ethers.utils.id('invalid') })).to.be.revertedWith('INVALID_POOL_ID');
      });

      it('reverts if token array is incorrect', async () => {
        // Missing - token addresses and max amounts min length must match
        await expect(
          joinPool({ tokenAddresses: tokenAddresses.slice(1), maxAmountsIn: array(0).slice(1) })
        ).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

        // Extra  - token addresses and max amounts min length must match
        await expect(
          joinPool({ tokenAddresses: tokenAddresses.concat(tokenAddresses[0]), maxAmountsIn: array(0).concat(bn(0)) })
        ).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

        // Unordered
        await expect(joinPool({ tokenAddresses: tokenAddresses.reverse() })).to.be.revertedWith('TOKENS_MISMATCH');
      });

      it('reverts if tokens and amounts length do not match', async () => {
        await expect(joinPool({ maxAmountsIn: array(0).slice(1) })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');
        await expect(joinPool({ maxAmountsIn: array(0).concat(bn(0)) })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');
      });
    });

    context('when called correctly', () => {
      context('with incorrect pool return values', () => {
        it('reverts if join amounts length does not match token length', async () => {
          // Missing
          await expect(joinPool({ joinAmounts: array(0).slice(1) })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

          // Extra
          await expect(joinPool({ joinAmounts: array(0).concat(bn(0)) })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');
        });

        it('reverts if due protocol fees length does not match token length', async () => {
          // Missing
          await expect(joinPool({ dueProtocolFeeAmounts: array(0).slice(1) })).to.be.revertedWith(
            'ARRAY_LENGTH_MISMATCH'
          );

          // Extra
          await expect(joinPool({ dueProtocolFeeAmounts: array(0).concat(bn(0)) })).to.be.revertedWith(
            'ARRAY_LENGTH_MISMATCH'
          );
        });

        it('reverts if join amounts and due protocol fees length do not match token length', async () => {
          // Missing
          await expect(
            joinPool({ joinAmounts: array(0).slice(1), dueProtocolFeeAmounts: array(0).slice(1) })
          ).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

          // Extra
          await expect(
            joinPool({ joinAmounts: array(0).concat(bn(0)), dueProtocolFeeAmounts: array(0).concat(bn(0)) })
          ).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');
        });
      });

      context('with correct pool return values', () => {
        context('with no due protocol fees', () => {
          const dueProtocolFeeAmounts = array(0);

          itJoinsCorrectlyWithAndWithoutInternalBalance({ dueProtocolFeeAmounts });
        });

        context('with due protocol fees', () => {
          const dueProtocolFeeAmounts = array(1e18);

          itJoinsCorrectlyWithAndWithoutInternalBalance({ dueProtocolFeeAmounts });
        });
      });
    });

    function itJoinsCorrectlyWithAndWithoutInternalBalance({
      dueProtocolFeeAmounts,
    }: {
      dueProtocolFeeAmounts: BigNumberish[];
    }) {
      context('not using internal balance', () => {
        const fromInternalBalance = false;

        context('with no internal balance', () => {
          itJoinsCorrectly({ fromInternalBalance, dueProtocolFeeAmounts });
        });

        context('with some internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            const transfers = [{ token: tokens.DAI.address, amount: bn(1.5e18), account: lp.address }]

            await vault.connect(lp).depositToInternalBalance(transfers);
          });

          itJoinsCorrectly({ fromInternalBalance, dueProtocolFeeAmounts });
        });
      });

      context('using internal balance', () => {
        const fromInternalBalance = true;

        context('with no internal balance', () => {
          itJoinsCorrectly({ fromInternalBalance, dueProtocolFeeAmounts });
        });

        context('with some internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            const transfers = [];

            for (let idx = 0; idx < tokenAddresses.length; ++idx) {
              transfers.push({ token: tokenAddresses[idx], amount: bn(1.5e18), account: lp.address });
            }
      
            await vault.connect(lp).depositToInternalBalance(transfers);
          });

          itJoinsCorrectly({ fromInternalBalance, dueProtocolFeeAmounts });
        });

        context('with enough internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            const transfers = [];

            for (let idx = 0; idx < tokenAddresses.length; ++idx) {
              transfers.push({ token: tokenAddresses[idx], amount: bn(1.5e18), account: lp.address });
            }
            
            await vault.connect(lp).depositToInternalBalance(transfers);
          });

          itJoinsCorrectly({ fromInternalBalance, dueProtocolFeeAmounts });
        });
      });
    }

    function itJoinsCorrectly({
      fromInternalBalance,
      dueProtocolFeeAmounts,
    }: {
      fromInternalBalance: boolean;
      dueProtocolFeeAmounts: BigNumberish[];
    }) {
      let expectedInternalBalanceToUse: BigNumber[];

      beforeEach('calculate intermediate values', async () => {
        const currentInternalBalances: BigNumber[] = await vault.getInternalBalance(lp.address, tokenAddresses);

        expectedInternalBalanceToUse = currentInternalBalances.map((balance, i) =>
          // If withdrawing from internal balance, the amount to withdraw is limited by the lower of the current
          // balance and the actual join amount.
          fromInternalBalance ? min(balance, joinAmounts[i]) : bn(0)
        );
      });

      it('takes tokens from the caller into the vault', async () => {
        const expectedTransferAmounts = arraySub(joinAmounts, expectedInternalBalanceToUse);

        // Tokens are sent from the LP, so the expected change is negative
        const lpChanges = tokenAddresses.reduce(
          (changes, token, i) => ({ ...changes, [symbol(token)]: expectedTransferAmounts[i].mul(-1) }),
          {}
        );

        // Tokens are sent to the Vault, so the expected change is positive
        const vaultChanges = tokenAddresses.reduce(
          (changes, token, i) => ({ ...changes, [symbol(token)]: expectedTransferAmounts[i] }),
          {}
        );

        await expectBalanceChange(() => joinPool({ fromInternalBalance, dueProtocolFeeAmounts }), tokens, [
          { account: vault, changes: vaultChanges },
          { account: lp, changes: lpChanges },
        ]);
      });

      it('deducts internal balance from the caller', async () => {
        const previousInternalBalances = await vault.getInternalBalance(lp.address, tokenAddresses);
        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });
        const currentInternalBalances = await vault.getInternalBalance(lp.address, tokenAddresses);

        // Internal balance is expected to decrease: previous - current should equal expected.
        expect(arraySub(previousInternalBalances, currentInternalBalances)).to.deep.equal(expectedInternalBalanceToUse);
      });

      it('assigns tokens to the pool', async () => {
        const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });
        const { balances: currentPoolBalances } = await vault.getPoolTokens(poolId);

        // The Pool balance is expected to increase by join amounts minus due protocol fees. Note that the deltas are
        // not necessarily positive, if the fees due are larger than the join amounts.
        expect(arraySub(currentPoolBalances, previousPoolBalances)).to.deep.equal(
          arraySub(joinAmounts, dueProtocolFeeAmounts)
        );
      });

      it('calls the pool with the join data', async () => {
        const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
        const { blockNumber: previousBlockNumber } = await vault.getPoolTokenBalanceInfo(poolId, tokenAddresses[0]);

        const receipt = await (await joinPool({ fromInternalBalance, dueProtocolFeeAmounts })).wait();

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
        const currentBlockNumber = await ethers.provider.getBlockNumber();

        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });

        for (const token of tokenAddresses) {
          const { blockNumber: newBlockNumber } = await vault.getPoolTokenBalanceInfo(poolId, token);
          expect(newBlockNumber).to.equal(currentBlockNumber + 1);
        }
      });

      it('emits PoolJoined from the vault', async () => {
        const receipt = await (await joinPool({ fromInternalBalance, dueProtocolFeeAmounts })).wait();

        expectEvent.inReceipt(receipt, 'PoolJoined', {
          poolId,
          liquidityProvider: lp.address,
          amountsIn: joinAmounts,
          protocolFees: dueProtocolFeeAmounts,
        });
      });

      it('collects protocol fees', async () => {
        const previousCollectedFees = await Promise.all(tokenAddresses.map((token) => vault.getCollectedFees([token])));
        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });
        const currentCollectedFees = await Promise.all(tokenAddresses.map((token) => vault.getCollectedFees([token])));

        expect(arraySub(currentCollectedFees, previousCollectedFees)).to.deep.equal(dueProtocolFeeAmounts);
      });

      it('joins multiple times', async () => {
        await Promise.all(
          times(3, () => async () => {
            const receipt = await (await joinPool({ fromInternalBalance, dueProtocolFeeAmounts })).wait();
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

              return expect(joinPool({ fromInternalBalance, dueProtocolFeeAmounts, maxAmountsIn })).to.be.revertedWith(
                'JOIN_ABOVE_MAX'
              );
            }
          })
        );
      });

      it('reverts if any of the amounts to transfer is larger than lp balance', async () => {
        const expectedTokensToTransfer = arraySub(joinAmounts, expectedInternalBalanceToUse);

        await Promise.all(
          expectedTokensToTransfer.map(async (amount: BigNumber, i: number) => {
            if (amount.gt(0)) {
              const token = tokens[symbol(tokenAddresses[i])];

              // Burn excess balance so that the LP is missing one token to join
              const currentBalance = await token.balanceOf(lp.address);
              await token.connect(lp).burn(currentBalance.sub(amount).add(1));

              return expect(joinPool({ fromInternalBalance, dueProtocolFeeAmounts })).to.be.revertedWith(
                'ERC20: transfer amount exceeds balance'
              );
            }
          })
        );
      });
    }
  }
});
