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

let admin: SignerWithAddress;
let creator: SignerWithAddress;
let lp: SignerWithAddress;
let recipient: SignerWithAddress;

let authorizer: Contract;
let vault: Contract;
let tokens: TokenList = {};

let TOKEN_ADDRESSES: string[];

describe('Vault - exit pool', () => {
  before(async () => {
    [, admin, creator, lp, recipient] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), admin.address);
    await vault.connect(admin).setProtocolSwapFee(fp(0.1));

    tokens = await deploySortedTokens(['DAI', 'MKR', 'SNX', 'BAT'], [18, 18, 18, 18]);
    TOKEN_ADDRESSES = [];

    for (const symbol in tokens) {
      // Mint tokens for the creator to create the Pool and deposit as Internal Balance
      await mintTokens(tokens, symbol, creator, (100e18).toString());
      await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

      // Mint tokens for the recipient to set as initial Internal Balance
      await mintTokens(tokens, symbol, recipient, (100e18).toString());
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

    function encodeExit(exitAmounts: BigNumberish[], dueProtocolFeeAmounts: BigNumberish[]): string {
      return ethers.utils.defaultAbiCoder.encode(['uint256[]', 'uint256[]'], [exitAmounts, dueProtocolFeeAmounts]);
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
      tokenAddreses?: string[];
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
          data.tokenAddreses ?? tokenAddresses,
          data.minAmountsOut ?? array(0),
          data.toInternalBalance ?? false,
          encodeExit(data.exitAmounts ?? exitAmounts, data.dueProtocolFeeAmounts ?? dueProtocolFeeAmounts)
        );
    }

    context('when called incorrectly', () => {
      it('reverts if the pool ID does not exist', async () => {
        await expect(exitPool({ poolId: ethers.utils.id('invalid') })).to.be.revertedWith('Nonexistent pool');
      });

      it('reverts if token array is incorrect', async () => {
        // Missing
        await expect(exitPool({ tokenAddreses: tokenAddresses.slice(1) })).to.be.revertedWith('ERR_TOKENS_MISMATCH');

        // Extra
        await expect(exitPool({ tokenAddreses: [...tokenAddresses, tokenAddresses[0]] })).to.be.revertedWith(
          'ERR_TOKENS_MISMATCH'
        );

        // Unordered
        await expect(
          exitPool({ tokenAddreses: [tokenAddresses[1], tokenAddresses[0], ...tokenAddresses.slice(2)] })
        ).to.be.revertedWith('ERR_TOKENS_MISMATCH');
      });

      it('reverts if tokens and amounts length do not match', async () => {
        await expect(exitPool({ minAmountsOut: array(0).slice(1) })).to.be.revertedWith(
          'ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH'
        );
        await expect(exitPool({ minAmountsOut: [...array(0), 0] })).to.be.revertedWith(
          'ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH'
        );
      });
    });

    context('when called correctly', () => {
      context('with incorrect pool return values', () => {
        it('reverts if exit amounts length does not match token length', async () => {
          // Missing
          await expect(exitPool({ exitAmounts: array(0).slice(1) })).to.be.revertedWith('ERR_AMOUNTS_OUT_LENGTH');

          // Extra
          await expect(exitPool({ exitAmounts: [...array(0), 0] })).to.be.revertedWith('ERR_AMOUNTS_OUT_LENGTH');
        });

        it('reverts if due protocol fees length does not match token length', async () => {
          // Missing
          await expect(exitPool({ dueProtocolFeeAmounts: array(0).slice(1) })).to.be.revertedWith(
            'ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH'
          );

          // Extra
          await expect(exitPool({ dueProtocolFeeAmounts: [...array(0), 0] })).to.be.revertedWith(
            'ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH'
          );
        });

        it('reverts if exit amounts and due protocol fees length do not match token length', async () => {
          // Missing
          await expect(
            exitPool({ exitAmounts: array(0).slice(1), dueProtocolFeeAmounts: array(0).slice(1) })
          ).to.be.revertedWith('ERR_AMOUNTS_OUT_LENGTH');

          // Extra
          await expect(
            exitPool({ exitAmounts: [...array(0), 0], dueProtocolFeeAmounts: [...array(0), 0] })
          ).to.be.revertedWith('ERR_AMOUNTS_OUT_LENGTH');
        });
      });

      context('with correct pool return values', () => {
        context('with no protocol withdraw fee', () => {
          itExitsCorrectlyWithAndWithoutDueProtocolFeesAndInternalBalance();
        });

        // TODO: enable these tests once protocol withdraw fees properly round up
        context.skip('with protocol withdraw fee', () => {
          beforeEach('set protocol withdraw fee', async () => {
            await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_WITHDRAW_FEE_ROLE(), admin.address);
            await vault.connect(admin).setProtocolWithdrawFee(fp(0.02));
          });

          itExitsCorrectlyWithAndWithoutDueProtocolFeesAndInternalBalance();
        });
      });
    });

    function itExitsCorrectlyWithAndWithoutDueProtocolFeesAndInternalBalance() {
      context('with no due protocol fees', () => {
        itExitsCorrectlyWithAndWithoutInternalBalance({ dueProtocolFeeAmounts: array(0) });
      });

      context('with due protocol fees', () => {
        itExitsCorrectlyWithAndWithoutInternalBalance({ dueProtocolFeeAmounts: array(1e18) });
      });
    }

    function itExitsCorrectlyWithAndWithoutInternalBalance({
      dueProtocolFeeAmounts,
    }: {
      dueProtocolFeeAmounts: BigNumberish[];
    }) {
      context('not using internal balance', () => {
        context('with no internal balance', () => {
          itExitsCorrectly({ toInternalBalance: false, dueProtocolFeeAmounts });
        });

        context('with some internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            await vault.connect(recipient).depositToInternalBalance(tokenAddresses, array(1.5e18), recipient.address);
          });

          itExitsCorrectly({ toInternalBalance: false, dueProtocolFeeAmounts });
        });
      });

      context('using internal balance', () => {
        context('with no internal balance', () => {
          itExitsCorrectly({ toInternalBalance: true, dueProtocolFeeAmounts });
        });

        context('with some internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            await vault.connect(recipient).depositToInternalBalance(tokenAddresses, array(1.5e18), recipient.address);
          });

          itExitsCorrectly({ toInternalBalance: true, dueProtocolFeeAmounts });
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
        const procotolWithdrawFee = await vault.getProtocolWithdrawFee();
        expectedProtocolWithdrawFeesToCollect = exitAmounts.map((amount) =>
          // Fixed point division rounding up, since the protocol withdraw fee is a fixed point number
          divCeil(amount.mul(procotolWithdrawFee), FP_SCALING_FACTOR)
        );
      });

      it('sends tokens from the vault to the recipient', async () => {
        const expectedTransferAmounts = toInternalBalance
          ? array(0)
          : arraySub(exitAmounts, expectedProtocolWithdrawFeesToCollect);

        // Tokens are sent to the recipient, so the expected change is positive
        const recipientChanges = Object.assign(
          {},
          ...tokenAddresses.map((token, i) => {
            return { [symbol(token)]: expectedTransferAmounts[i] };
          })
        );

        // Tokens are sent from the Vault, so the expected change is negative
        const vaultChanges = Object.assign(
          {},
          ...tokenAddresses.map((token, i) => {
            return { [symbol(token)]: expectedTransferAmounts[i].mul(-1) };
          })
        );

        await expectBalanceChange(() => exitPool({ toInternalBalance, dueProtocolFeeAmounts }), tokens, [
          { account: vault, changes: vaultChanges },
          { account: recipient, changes: recipientChanges },
        ]);
      });

      it('assigns internal balance to the caller', async () => {
        const internalBalancesBefore = await vault.getInternalBalance(recipient.address, tokenAddresses);
        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });
        const internalBalancesAfter = await vault.getInternalBalance(recipient.address, tokenAddresses);

        // Internal balance is expected to increase: after - before should equal expected. Protocol withdraw fees are
        // not charged.
        const expectedInternalBalanceIncrease = toInternalBalance ? exitAmounts : array(0);
        expect(arraySub(internalBalancesAfter, internalBalancesBefore)).to.deep.equal(expectedInternalBalanceIncrease);
      });

      it('deducts tokens from the pool', async () => {
        const poolBalancesBefore = await vault.getPoolTokenBalances(poolId, tokenAddresses);
        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });
        const poolBalancesAfter = await vault.getPoolTokenBalances(poolId, tokenAddresses);

        // The Pool balance is expected to decrease by exit amounts plus due protocol fees.
        expect(arraySub(poolBalancesBefore, poolBalancesAfter)).to.deep.equal(
          arrayAdd(exitAmounts, dueProtocolFeeAmounts)
        );
      });

      it('calls the pool with the exit data', async () => {
        const poolBalancesBefore = await vault.getPoolTokenBalances(poolId, tokenAddresses);

        const receipt = await (await exitPool({ toInternalBalance, dueProtocolFeeAmounts })).wait();

        expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnExitPoolCalled', {
          poolId,
          sender: lp.address,
          recipient: recipient.address,
          currentBalances: poolBalancesBefore,
          minAmountsOut: array(0),
          protocolSwapFee: await vault.getProtocolSwapFee(),
          userData: encodeExit(exitAmounts, dueProtocolFeeAmounts),
        });
      });

      it('collects protocol fees', async () => {
        const collectedFeesBefore = await Promise.all(
          tokenAddresses.map((token) => vault.getCollectedFeesByToken(token))
        );
        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });
        const collectedFeesAfter = await Promise.all(
          tokenAddresses.map((token) => vault.getCollectedFeesByToken(token))
        );

        // Fees from both sources are lumped together.
        expect(arraySub(collectedFeesAfter, collectedFeesBefore)).to.deep.equal(
          arrayAdd(dueProtocolFeeAmounts, expectedProtocolWithdrawFeesToCollect)
        );
      });

      it('exits multiple times', async () => {
        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });
        await exitPool({ toInternalBalance, dueProtocolFeeAmounts });
      });

      it('exits the pool fully', async () => {
        const poolBalances: BigNumber[] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
        const fullExitAmounts = arraySub(poolBalances, dueProtocolFeeAmounts);

        await exitPool({ toInternalBalance, dueProtocolFeeAmounts, exitAmounts: fullExitAmounts });

        expect(await vault.getPoolTokenBalances(poolId, tokenAddresses)).to.deep.equal(array(0));
      });

      it('reverts if any of the min amounts out is not enough', async () => {
        await Promise.all(
          exitAmounts.map((amount, i) => {
            const minAmountsOut = array(0);
            minAmountsOut[i] = amount.add(1);

            return expect(exitPool({ toInternalBalance, dueProtocolFeeAmounts, minAmountsOut })).to.be.revertedWith(
              'ERR_EXIT_BELOW_MIN'
            );
          })
        );
      });

      it('reverts if any of the amounts to exit plus fees is larger than the pool balance', async () => {
        const poolBalances: BigNumber[] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

        await Promise.all(
          poolBalances.map((balance, i) => {
            const excessiveExitAmounts = [...exitAmounts];
            excessiveExitAmounts[i] = balance.sub(dueProtocolFeeAmounts[i]).add(1);

            return expect(
              exitPool({ toInternalBalance, dueProtocolFeeAmounts, exitAmounts: excessiveExitAmounts })
            ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
          })
        );
      });
    }
  }
});
