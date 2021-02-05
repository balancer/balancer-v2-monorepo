import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { MAX_UINT256, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { deploySortedTokens, mintTokens, TokenList } from '../../lib/helpers/tokens';
import { PoolSpecializationSetting, MinimalSwapInfoPool, GeneralPool, TwoTokenPool } from '../../lib/helpers/pools';
import { bn, BigNumberish, fp, arraySub, arrayAdd, FP_SCALING_FACTOR, divCeil } from '../../lib/helpers/numbers';
import { expectBalanceChange } from '../helpers/tokenBalance';
import * as expectEvent from '../helpers/expectEvent';
import { times } from 'lodash';
import { encodeExit } from '../helpers/mockPool';

describe('Vault - exit pool', () => {
  let admin: SignerWithAddress, creator: SignerWithAddress, lp: SignerWithAddress, recipient: SignerWithAddress;
  let authorizer: Contract, vault: Contract;
  let tokens: TokenList = {};

  const SWAP_FEE = fp(0.1);
  let TOKEN_ADDRESSES: string[];

  before(async () => {
    [, admin, creator, lp, recipient] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_FEES_ROLE(), admin.address);
    await vault.connect(admin).setProtocolFees(SWAP_FEE, 0, 0);

    tokens = await deploySortedTokens(['DAI', 'MKR', 'SNX', 'BAT'], [18, 18, 18, 18]);
    TOKEN_ADDRESSES = [];

    for (const symbol in tokens) {
      // Mint tokens for the creator to create the Pool and deposit as Internal Balance
      await mintTokens(tokens, symbol, creator, bn(100e18));
      await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

      // Mint tokens for the recipient to set as initial Internal Balance
      await mintTokens(tokens, symbol, recipient, bn(100e18));
      await tokens[symbol].connect(recipient).approve(vault.address, MAX_UINT256);

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
    itExitsSpecializedPoolCorrectly(GeneralPool, 4);
  });

  describe('with minimal swap info pool', () => {
    itExitsSpecializedPoolCorrectly(MinimalSwapInfoPool, 3);
  });

  describe('with two token pool', () => {
    itExitsSpecializedPoolCorrectly(TwoTokenPool, 2);
  });

  function itExitsSpecializedPoolCorrectly(specialization: PoolSpecializationSetting, tokenAmount: number) {
    let pool: Contract;
    let poolId: string;

    let tokenAddresses: string[];

    let exitAmounts: BigNumber[];
    let dueProtocolFeeAmounts: BigNumber[];

    function array(value: BigNumberish): BigNumber[] {
      return Array(tokenAmount).fill(bn(value));
    }

    beforeEach('deploy & register pool', async () => {
      pool = await deploy('MockPool', { args: [vault.address, specialization] });
      poolId = await pool.getPoolId();

      tokenAddresses = TOKEN_ADDRESSES.slice(0, tokenAmount);
      await pool.registerTokens(tokenAddresses, Array(tokenAmount).fill(ZERO_ADDRESS));

      exitAmounts = tokenAddresses.map(
        (_, i) =>
          bn(1e18)
            .mul(i + 1)
            .add(1) // Cannot be evenly divided when calculating protocol fees, exposing the rounding behavior
      );
      dueProtocolFeeAmounts = array(0);

      // Join the Pool from the creator so that it has some tokens to exit and pay protocol fees with
      await vault
        .connect(creator)
        .joinPool(poolId, ZERO_ADDRESS, tokenAddresses, array(MAX_UINT256), false, encodeExit(array(50e18), array(0)));

      // Deposit to Internal Balance from the creator so that the Vault has some additional tokens. Otherwise, tests
      // might fail not because the Vault checks its accounting, but because it is out of tokens to send.
      await vault.connect(creator).depositToInternalBalance(tokenAddresses, array(50e18), creator.address);
    });

    type ExitPoolData = {
      poolId?: string;
      tokenAddresses?: string[];
      minAmountsOut?: BigNumberish[];
      toInternalBalance?: boolean;
      exitAmounts?: BigNumberish[];
      dueProtocolFeeAmounts?: BigNumberish[];
    };

    function exitPool(data: ExitPoolData): Promise<ContractTransaction> {
      return vault
        .connect(lp)
        .exitPool(
          data.poolId ?? poolId,
          recipient.address,
          data.tokenAddresses ?? tokenAddresses,
          data.minAmountsOut ?? array(0),
          data.toInternalBalance ?? false,
          encodeExit(data.exitAmounts ?? exitAmounts, data.dueProtocolFeeAmounts ?? dueProtocolFeeAmounts)
        );
    }

    context('when called incorrectly', () => {
      it('reverts if the pool ID does not exist', async () => {
        await expect(exitPool({ poolId: ethers.utils.id('invalid') })).to.be.revertedWith('INVALID_POOL_ID');
      });

      it('reverts if token array is incorrect', async () => {
        // Missing - token addresses and min amounts out length must match
        await expect(
          exitPool({ tokenAddresses: tokenAddresses.slice(1), minAmountsOut: array(0).slice(1) })
        ).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

        // Extra - token addresses and min amounts out length must match
        await expect(
          exitPool({ tokenAddresses: tokenAddresses.concat(tokenAddresses[0]), minAmountsOut: array(0).concat(bn(0)) })
        ).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

        // Unordered
        await expect(exitPool({ tokenAddresses: tokenAddresses.reverse() })).to.be.revertedWith('TOKENS_MISMATCH');
      });

      it('reverts if tokens and amounts length do not match', async () => {
        await expect(exitPool({ minAmountsOut: array(0).slice(1) })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

        await expect(exitPool({ minAmountsOut: array(0).concat(bn(0)) })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');
      });
    });

    context('when called correctly', () => {
      context('with incorrect pool return values', () => {
        it('reverts if exit amounts length does not match token length', async () => {
          // Missing
          await expect(exitPool({ exitAmounts: array(0).slice(1) })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

          // Extra
          await expect(exitPool({ exitAmounts: array(0).concat(bn(0)) })).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');
        });

        it('reverts if due protocol fees length does not match token length', async () => {
          // Missing
          await expect(exitPool({ dueProtocolFeeAmounts: array(0).slice(1) })).to.be.revertedWith(
            'ARRAY_LENGTH_MISMATCH'
          );

          // Extra
          await expect(exitPool({ dueProtocolFeeAmounts: array(0).concat(bn(0)) })).to.be.revertedWith(
            'ARRAY_LENGTH_MISMATCH'
          );
        });

        it('reverts if exit amounts and due protocol fees length do not match token length', async () => {
          // Missing
          await expect(
            exitPool({ exitAmounts: array(0).slice(1), dueProtocolFeeAmounts: array(0).slice(1) })
          ).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');

          // Extra
          await expect(
            exitPool({ exitAmounts: array(0).concat(bn(0)), dueProtocolFeeAmounts: array(0).concat(bn(0)) })
          ).to.be.revertedWith('ARRAY_LENGTH_MISMATCH');
        });
      });

      context('with correct pool return values', () => {
        context('with no protocol withdraw fee', () => {
          itExitsCorrectlyWithAndWithoutDueProtocolFeesAndInternalBalance();
        });

        // TODO: enable these tests once protocol withdraw fees properly round up
        context.skip('with protocol withdraw fee', () => {
          beforeEach('set protocol withdraw fee', async () => {
            await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_FEES_ROLE(), admin.address);
            await vault.connect(admin).setProtocolFees(SWAP_FEE, fp(0.2), 0);
          });

          itExitsCorrectlyWithAndWithoutDueProtocolFeesAndInternalBalance();
        });
      });
    });

    function itExitsCorrectlyWithAndWithoutDueProtocolFeesAndInternalBalance() {
      const dueProtocolFeeAmounts = array(0);

      context('with no due protocol fees', () => {
        itExitsCorrectlyWithAndWithoutInternalBalance({ dueProtocolFeeAmounts });
      });

      context('with due protocol fees', () => {
        const dueProtocolFeeAmounts = array(1e18);

        itExitsCorrectlyWithAndWithoutInternalBalance({ dueProtocolFeeAmounts });
      });
    }

    function itExitsCorrectlyWithAndWithoutInternalBalance({
      dueProtocolFeeAmounts,
    }: {
      dueProtocolFeeAmounts: BigNumberish[];
    }) {
      context('not using internal balance', () => {
        const toInternalBalance = false;

        context('without internal balance', () => {
          itExitsCorrectly({ toInternalBalance, dueProtocolFeeAmounts });
        });

        context('with some internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            await vault.connect(recipient).depositToInternalBalance(tokenAddresses, array(1.5e18), recipient.address);
          });

          itExitsCorrectly({ toInternalBalance, dueProtocolFeeAmounts });
        });
      });

      context('using internal balance', () => {
        const toInternalBalance = true;

        context('with no internal balance', () => {
          itExitsCorrectly({ toInternalBalance, dueProtocolFeeAmounts });
        });

        context('with some internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            await vault.connect(recipient).depositToInternalBalance(tokenAddresses, array(1.5e18), recipient.address);
          });

          itExitsCorrectly({ toInternalBalance, dueProtocolFeeAmounts });
        });
      });
    }

    function itExitsCorrectly({
      toInternalBalance,
      dueProtocolFeeAmounts,
    }: {
      toInternalBalance: boolean;
      dueProtocolFeeAmounts: BigNumberish[];
    }) {
      let expectedProtocolWithdrawFeesToCollect: BigNumber[];

      beforeEach('calculate intermediate values', async () => {
        const { withdrawFee } = await vault.getProtocolFees();
        expectedProtocolWithdrawFeesToCollect = exitAmounts.map((amount) =>
          // Fixed point division rounding up, since the protocol withdraw fee is a fixed point number
          divCeil(amount.mul(withdrawFee), FP_SCALING_FACTOR)
        );
      });

      it('sends tokens from the vault to the recipient', async () => {
        const expectedTransferAmounts = toInternalBalance
          ? array(0)
          : arraySub(exitAmounts, expectedProtocolWithdrawFeesToCollect);

        // Tokens are sent to the recipient, so the expected change is positive
        const recipientChanges = tokenAddresses.reduce(
          (changes, token, i) => ({ ...changes, [symbol(token)]: expectedTransferAmounts[i] }),
          {}
        );

        // Tokens are sent from the Vault, so the expected change is negative
        const vaultChanges = tokenAddresses.reduce(
          (changes, token, i) => ({ ...changes, [symbol(token)]: expectedTransferAmounts[i].mul(-1) }),
          {}
        );

        await expectBalanceChange(() => exitPool({ toInternalBalance, dueProtocolFeeAmounts }), tokens, [
          { account: vault, changes: vaultChanges },
          { account: recipient, changes: recipientChanges },
        ]);
      });

      it('assigns internal balance to the caller', async () => {
        const previousInternalBalances = await vault.getInternalBalance(recipient.address, tokenAddresses);
        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });
        const currentInternalBalances = await vault.getInternalBalance(recipient.address, tokenAddresses);

        // Internal balance is expected to increase: current - previous should equal expected. Protocol withdraw fees
        // are not charged.
        const expectedInternalBalanceIncrease = toInternalBalance ? exitAmounts : array(0);
        expect(arraySub(currentInternalBalances, previousInternalBalances)).to.deep.equal(
          expectedInternalBalanceIncrease
        );
      });

      it('deducts tokens from the pool', async () => {
        const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });
        const { balances: currentPoolBalances } = await vault.getPoolTokens(poolId);

        // The Pool balance is expected to decrease by exit amounts plus due protocol fees.
        expect(arraySub(previousPoolBalances, currentPoolBalances)).to.deep.equal(
          arrayAdd(exitAmounts, dueProtocolFeeAmounts)
        );
      });

      it('calls the pool with the exit data', async () => {
        const { balances: previousPoolBalances } = await vault.getPoolTokens(poolId);
        const { blockNumber: previousBlockNumber } = await vault.getPoolTokenBalanceInfo(poolId, tokenAddresses[0]);

        const receipt = await (await exitPool({ toInternalBalance, dueProtocolFeeAmounts })).wait();

        expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnExitPoolCalled', {
          poolId,
          sender: lp.address,
          recipient: recipient.address,
          currentBalances: previousPoolBalances,
          protocolSwapFee: (await vault.getProtocolFees()).swapFee,
          latestBlockNumberUsed: previousBlockNumber,
          userData: encodeExit(exitAmounts, dueProtocolFeeAmounts),
        });
      });

      it('updates the latest block number used for all tokens', async () => {
        const currentBlockNumber = await ethers.provider.getBlockNumber();

        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });

        for (const token of tokenAddresses) {
          const { blockNumber: newBlockNumber } = await vault.getPoolTokenBalanceInfo(poolId, token);
          expect(newBlockNumber).to.equal(currentBlockNumber + 1);
        }
      });

      it('emits PoolExited from the vault', async () => {
        const receipt = await (await exitPool({ toInternalBalance, dueProtocolFeeAmounts })).wait();

        expectEvent.inReceipt(receipt, 'PoolExited', {
          poolId,
          liquidityProvider: lp.address,
          amountsOut: exitAmounts,
          protocolFees: dueProtocolFeeAmounts,
        });
      });

      it('collects protocol fees', async () => {
        const previousCollectedFees = await Promise.all(tokenAddresses.map((token) => vault.getCollectedFees([token])));
        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });
        const currentCollectedFees = await Promise.all(tokenAddresses.map((token) => vault.getCollectedFees([token])));

        // Fees from both sources are lumped together.
        expect(arraySub(currentCollectedFees, previousCollectedFees)).to.deep.equal(
          arrayAdd(dueProtocolFeeAmounts, expectedProtocolWithdrawFeesToCollect)
        );
      });

      it('exits multiple times', async () => {
        await Promise.all(
          times(3, () => async () => {
            const receipt = await (await exitPool({ toInternalBalance, dueProtocolFeeAmounts })).wait();
            expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnExitPoolCalled');
          })
        );
      });

      it('exits the pool fully', async () => {
        const { balances: poolBalances } = await vault.getPoolTokens(poolId);
        const fullExitAmounts = arraySub(poolBalances, dueProtocolFeeAmounts);

        await exitPool({ toInternalBalance, dueProtocolFeeAmounts, exitAmounts: fullExitAmounts });

        const { balances: currentBalances } = await vault.getPoolTokens(poolId);
        expect(currentBalances).to.deep.equal(array(0));
      });

      it('reverts if any of the min amounts out is not enough', async () => {
        await Promise.all(
          exitAmounts.map((amount, i) => {
            const minAmountsOut = array(0);
            minAmountsOut[i] = amount.add(1);

            return expect(exitPool({ toInternalBalance, dueProtocolFeeAmounts, minAmountsOut })).to.be.revertedWith(
              'EXIT_BELOW_MIN'
            );
          })
        );
      });

      it('reverts if any of the amounts to exit plus fees is larger than the pool balance', async () => {
        const { balances: poolBalances } = await vault.getPoolTokens(poolId);

        await Promise.all(
          poolBalances.map((balance: BigNumber, i: number) => {
            const excessiveExitAmounts = [...exitAmounts];
            excessiveExitAmounts[i] = balance.sub(dueProtocolFeeAmounts[i]).add(1);

            return expect(
              exitPool({ toInternalBalance, dueProtocolFeeAmounts, exitAmounts: excessiveExitAmounts })
            ).to.be.revertedWith('SUB_OVERFLOW');
          })
        );
      });
    }
  }
});
