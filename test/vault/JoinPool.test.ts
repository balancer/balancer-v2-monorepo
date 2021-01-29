import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { MAX_UINT256, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { deploySortedTokens, mintTokens, TokenList } from '../../lib/helpers/tokens';
import { PoolSpecializationSetting, MinimalSwapInfoPool, GeneralPool, TwoTokenPool } from '../../lib/helpers/pools';
import { arraySub, bn, BigNumberish, bnMin, fp } from '../../lib/helpers/numbers';
import { expectBalanceChange } from '../helpers/tokenBalance';
import * as expectEvent from '../helpers/expectEvent';

let admin: SignerWithAddress;
let creator: SignerWithAddress;
let lp: SignerWithAddress;

let authorizer: Contract;
let vault: Contract;
let tokens: TokenList = {};

let TOKEN_ADDRESSES: string[];

describe('Vault - join pool', () => {
  before(async () => {
    [, admin, creator, lp] = await ethers.getSigners();
  });

  beforeEach('deploy vault & tokens', async () => {
    authorizer = await deploy('Authorizer', { args: [admin.address] });
    vault = await deploy('Vault', { args: [authorizer.address] });

    await authorizer.connect(admin).grantRole(await authorizer.SET_PROTOCOL_SWAP_FEE_ROLE(), admin.address);
    await vault.connect(admin).setProtocolSwapFee(fp(0.1));

    tokens = await deploySortedTokens(['DAI', 'MKR', 'SNX', 'BAT'], [18, 18, 18, 18]);
    TOKEN_ADDRESSES = [];

    for (const symbol in tokens) {
      // Mint tokens for the creator to create the Pool
      await mintTokens(tokens, symbol, creator, (100e18).toString());
      await tokens[symbol].connect(creator).approve(vault.address, MAX_UINT256);

      // Mint tokens for the lp to join the Pool
      await mintTokens(tokens, symbol, lp, (100e18).toString());
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

    function encodeJoin(joinAmounts: BigNumberish[], dueProtocolFeeAmounts: BigNumberish[]): string {
      return ethers.utils.defaultAbiCoder.encode(['uint256[]', 'uint256[]'], [joinAmounts, dueProtocolFeeAmounts]);
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
      tokenAddreses?: string[];
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
          data.tokenAddreses ?? tokenAddresses,
          data.maxAmountsIn ?? array(MAX_UINT256),
          data.fromInternalBalance ?? false,
          encodeJoin(data.joinAmounts ?? joinAmounts, data.dueProtocolFeeAmounts ?? dueProtocolFeeAmounts)
        );
    }

    context('when called incorrectly', () => {
      it('reverts if the pool ID does not exist', async () => {
        await expect(joinPool({ poolId: ethers.utils.id('invalid') })).to.be.revertedWith('Nonexistent pool');
      });

      it('reverts if token array is incorrect', async () => {
        // Missing
        await expect(joinPool({ tokenAddreses: tokenAddresses.slice(1) })).to.be.revertedWith('ERR_TOKENS_MISMATCH');

        // Extra
        await expect(joinPool({ tokenAddreses: [...tokenAddresses, tokenAddresses[0]] })).to.be.revertedWith(
          'ERR_TOKENS_MISMATCH'
        );

        // Unordered
        await expect(joinPool({ tokenAddreses: tokenAddresses.reverse() })).to.be.revertedWith('ERR_TOKENS_MISMATCH');
      });

      it('reverts if tokens and amounts length do not match', async () => {
        await expect(joinPool({ maxAmountsIn: array(0).slice(1) })).to.be.revertedWith(
          'ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH'
        );
        await expect(joinPool({ maxAmountsIn: array(0).concat(bn(0)) })).to.be.revertedWith(
          'ERR_TOKENS_AMOUNTS_LENGTH_MISMATCH'
        );
      });
    });

    context('when called correctly', () => {
      context('with incorrect pool return values', () => {
        it('reverts if join amounts length does not match token length', async () => {
          // Missing
          await expect(joinPool({ joinAmounts: array(0).slice(1) })).to.be.revertedWith('ERR_AMOUNTS_IN_LENGTH');

          // Extra
          await expect(joinPool({ joinAmounts: array(0).concat(bn(0)) })).to.be.revertedWith('ERR_AMOUNTS_IN_LENGTH');
        });

        it('reverts if due protocol fees length does not match token length', async () => {
          // Missing
          await expect(joinPool({ dueProtocolFeeAmounts: array(0).slice(1) })).to.be.revertedWith(
            'ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH'
          );

          // Extra
          await expect(joinPool({ dueProtocolFeeAmounts: array(0).concat(bn(0)) })).to.be.revertedWith(
            'ERR_DUE_PROTOCOL_FEE_AMOUNTS_LENGTH'
          );
        });

        it('reverts if join amounts and due protocol fees length do not match token length', async () => {
          // Missing
          await expect(
            joinPool({ joinAmounts: array(0).slice(1), dueProtocolFeeAmounts: array(0).slice(1) })
          ).to.be.revertedWith('ERR_AMOUNTS_IN_LENGTH');

          // Extra
          await expect(
            joinPool({ joinAmounts: array(0).concat(bn(0)), dueProtocolFeeAmounts: array(0).concat(bn(0)) })
          ).to.be.revertedWith('ERR_AMOUNTS_IN_LENGTH');
        });
      });

      context('with correct pool return values', () => {
        context('with no due protocol fees', () => {
          itJoinsCorrectlyWithAndWithoutInternalBalance({ dueProtocolFeeAmounts: array(0) });
        });

        context('with due protocol fees', () => {
          itJoinsCorrectlyWithAndWithoutInternalBalance({ dueProtocolFeeAmounts: array(1e18) });
        });
      });
    });

    function itJoinsCorrectlyWithAndWithoutInternalBalance({
      dueProtocolFeeAmounts,
    }: {
      dueProtocolFeeAmounts: BigNumberish[];
    }) {
      context('not using internal balance', () => {
        context('with no internal balance', () => {
          itJoinsCorrectly({ fromInternalBalance: false, dueProtocolFeeAmounts });
        });

        context('with some internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            await vault.connect(lp).depositToInternalBalance(tokenAddresses, array(1.5e18), lp.address);
          });

          itJoinsCorrectly({ fromInternalBalance: false, dueProtocolFeeAmounts });
        });
      });

      context('using internal balance', () => {
        context('with no internal balance', () => {
          itJoinsCorrectly({ fromInternalBalance: true, dueProtocolFeeAmounts });
        });

        context('with some internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            await vault.connect(lp).depositToInternalBalance(tokenAddresses, array(1.5e18), lp.address);
          });

          itJoinsCorrectly({ fromInternalBalance: true, dueProtocolFeeAmounts });
        });

        context('with enough internal balance', () => {
          beforeEach('deposit to internal balance', async () => {
            await vault.connect(lp).depositToInternalBalance(tokenAddresses, array(100e18), lp.address);
          });

          itJoinsCorrectly({ fromInternalBalance: true, dueProtocolFeeAmounts });
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
          fromInternalBalance ? bnMin(balance, joinAmounts[i]) : bn(0)
        );
      });

      it('takes tokens from the caller into the vault', async () => {
        const expectedTransferAmounts = arraySub(joinAmounts, expectedInternalBalanceToUse);

        // Tokens are sent from the LP, so the expected change is negative
        const lpChanges = Object.assign(
          {},
          ...tokenAddresses.map((token, i) => {
            return { [symbol(token)]: -expectedTransferAmounts[i] };
          })
        );

        // Tokens are sent to the Vault, so the expected change is positive
        const vaultChanges = Object.assign(
          {},
          ...tokenAddresses.map((token, i) => {
            return { [symbol(token)]: expectedTransferAmounts[i] };
          })
        );

        await expectBalanceChange(() => joinPool({ fromInternalBalance, dueProtocolFeeAmounts }), tokens, [
          { account: vault, changes: vaultChanges },
          { account: lp, changes: lpChanges },
        ]);
      });

      it('deducts internal balance from the caller', async () => {
        const internalBalancesBefore = await vault.getInternalBalance(lp.address, tokenAddresses);
        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });
        const internalBalancesAfter = await vault.getInternalBalance(lp.address, tokenAddresses);

        // Internal balance is expected to decrease: before - after should equal expected.
        expect(arraySub(internalBalancesBefore, internalBalancesAfter)).to.deep.equal(expectedInternalBalanceToUse);
      });

      it('assigns tokens to the pool', async () => {
        const poolBalancesBefore = await vault.getPoolTokenBalances(poolId, tokenAddresses);
        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });
        const poolBalancesAfter = await vault.getPoolTokenBalances(poolId, tokenAddresses);

        // The Pool balance is expected to increase by join amounts minus due protocol fees. Note that the deltas are
        // not necessarily positive, if the fees due are larger than the join amounts.
        expect(arraySub(poolBalancesAfter, poolBalancesBefore)).to.deep.equal(
          arraySub(joinAmounts, dueProtocolFeeAmounts)
        );
      });

      it('calls the pool with the join data', async () => {
        const poolBalancesBefore = await vault.getPoolTokenBalances(poolId, tokenAddresses);

        const receipt = await (await joinPool({ fromInternalBalance, dueProtocolFeeAmounts })).wait();

        expectEvent.inIndirectReceipt(receipt, pool.interface, 'OnJoinPoolCalled', {
          poolId,
          sender: lp.address,
          recipient: ZERO_ADDRESS,
          currentBalances: poolBalancesBefore,
          maxAmountsIn: array(MAX_UINT256),
          protocolSwapFee: await vault.getProtocolSwapFee(),
          userData: encodeJoin(joinAmounts, dueProtocolFeeAmounts),
        });
      });

      it('collects protocol fees', async () => {
        const collectedFeesBefore = await Promise.all(
          tokenAddresses.map((token) => vault.getCollectedFeesByToken(token))
        );
        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });
        const collectedFeesAfter = await Promise.all(
          tokenAddresses.map((token) => vault.getCollectedFeesByToken(token))
        );

        expect(arraySub(collectedFeesAfter, collectedFeesBefore)).to.deep.equal(dueProtocolFeeAmounts);
      });

      it('joins multiple times', async () => {
        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });
        await joinPool({ fromInternalBalance, dueProtocolFeeAmounts });
      });

      it('reverts if any of the max amounts in is not enough', async () => {
        await Promise.all(
          joinAmounts.map((amount, i) => {
            if (amount.gt(0)) {
              const maxAmountsIn = array(MAX_UINT256);
              maxAmountsIn[i] = amount.sub(1);

              return expect(joinPool({ fromInternalBalance, dueProtocolFeeAmounts, maxAmountsIn })).to.be.revertedWith(
                'ERR_JOIN_ABOVE_MAX'
              );
            }
          })
        );
      });

      it('reverts if any of the amounts to transfer is larger than lp balance', async () => {
        const expectedTokensToTransfer = arraySub(joinAmounts, expectedInternalBalanceToUse);

        await Promise.all(
          expectedTokensToTransfer.map(async (amount, i) => {
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
