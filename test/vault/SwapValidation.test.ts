import { ethers } from 'hardhat';
import { BigNumber, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../lib/helpers/deploy';
import { deploySortedTokens, TokenList } from '../../lib/helpers/tokens';
import { MAX_INT256, MAX_UINT256, ZERO_ADDRESS } from '../../lib/helpers/constants';
import { GeneralPool } from '../../lib/helpers/pools';
import { encodeJoin } from '../helpers/mockPool';
import { bn } from '../../lib/helpers/numbers';
import * as expectEvent from '../helpers/expectEvent';
import { FundManagement, Swap, toSwapIn, toSwapOut } from '../../lib/helpers/trading';
import { expect } from 'chai';

describe('Vault - swap validation', () => {
  let vault: Contract;
  let tokens: TokenList, tokenAddresses: string[];
  let lp: SignerWithAddress, trader: SignerWithAddress, other: SignerWithAddress;

  let poolIds: string[];

  beforeEach('setup', async () => {
    [, lp, trader, other] = await ethers.getSigners();

    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await deploySortedTokens(['DAI', 'MKR', 'SNX', 'BAT'], [18, 18, 18, 18]);

    const initialBalance = bn(100e18);
    const totalPools = 5;

    tokenAddresses = [];
    for (const symbol in tokens) {
      tokenAddresses.push(tokens[symbol].address);

      // lp tokens are used to seed pools
      await tokens[symbol].mint(lp.address, initialBalance.mul(totalPools));
      await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);

      await tokens[symbol].mint(trader.address, initialBalance);
      await tokens[symbol].connect(trader).approve(vault.address, MAX_UINT256);
    }

    poolIds = [];
    for (let i = 0; i < totalPools; ++i) {
      // The Pool specialization setting does not affect validation
      const pool = await deploy('MockPool', { args: [vault.address, GeneralPool] });
      await pool.registerTokens(tokenAddresses, Array(tokenAddresses.length).fill(ZERO_ADDRESS));

      const poolId = await pool.getPoolId();

      await vault
        .connect(lp)
        .joinPool(
          poolId,
          ZERO_ADDRESS,
          tokenAddresses,
          Array(tokenAddresses.length).fill(MAX_UINT256),
          false,
          encodeJoin(Array(tokenAddresses.length).fill(initialBalance), Array(tokenAddresses.length).fill(0))
        );

      poolIds.push(poolId);
    }
  });

  let swaps: Swap[];
  beforeEach('create random swaps', async () => {
    const randomInt = (max: number) => Math.floor(Math.random() * Math.floor(max));

    const tokenInIndex = randomInt(tokenAddresses.length);
    const tokenOutIndex = tokenInIndex == 0 ? tokenInIndex + 1 : tokenInIndex - 1; // Must not equal token in index

    swaps = [];
    for (let i = 0; i < 10; ++i) {
      swaps.push({
        poolId: poolIds[randomInt(poolIds.length)],
        tokenInIndex,
        tokenOutIndex,
        amount: bn(randomInt(1e18)),
        userData: '0x',
      });
    }
  });

  context('in swaps given in', () => {
    const doSwap = (funds: FundManagement, limits: BigNumber[], deadline: BigNumber): Promise<ContractTransaction> => {
      return vault.connect(trader).batchSwapGivenIn(toSwapIn(swaps), tokenAddresses, funds, limits, deadline);
    };

    const querySwap = (funds: FundManagement): Promise<BigNumber[]> => {
      return vault.callStatic.queryBatchSwapGivenIn(toSwapIn(swaps), tokenAddresses, funds);
    };

    itValidatesCorrectlyInAllCases(doSwap, querySwap);
  });

  context('in swaps given out', () => {
    const doSwap = (funds: FundManagement, limits: BigNumber[], deadline: BigNumber): Promise<ContractTransaction> => {
      return vault.connect(trader).batchSwapGivenOut(toSwapOut(swaps), tokenAddresses, funds, limits, deadline);
    };

    const querySwap = (funds: FundManagement): Promise<BigNumber[]> => {
      return vault.callStatic.queryBatchSwapGivenOut(toSwapOut(swaps), tokenAddresses, funds);
    };

    itValidatesCorrectlyInAllCases(doSwap, querySwap);
  });

  function itValidatesCorrectlyInAllCases(
    doSwap: (funds: FundManagement, limits: BigNumber[], deadline: BigNumber) => Promise<ContractTransaction>,
    querySwap: (funds: FundManagement) => Promise<BigNumber[]>
  ) {
    let funds: FundManagement;
    beforeEach('setup funds', async () => {
      funds = {
        recipient: other.address,
        fromInternalBalance: false,
        toInternalBalance: false,
      };
    });

    context('with expired deadline', () => {
      it('reverts', async () => {
        const now = bn((await ethers.provider.getBlock('latest')).timestamp);
        const deadline = now.sub(5);

        await expect(doSwap(funds, Array(tokenAddresses.length).fill(MAX_INT256), deadline)).to.be.revertedWith(
          'SWAP_DEADLINE'
        );
      });
    });

    context('with unexpired deadline', () => {
      let deadline: BigNumber;
      beforeEach('set deadline', async () => {
        const now = bn((await ethers.provider.getBlock('latest')).timestamp);
        deadline = now.add(10);
      });

      it('reverts if there are less limits than tokens', async () => {
        await expect(doSwap(funds, Array(tokenAddresses.length - 1).fill(MAX_INT256), deadline)).to.be.revertedWith(
          'TOKENS_LIMITS_MISMATCH'
        );
      });

      it('reverts if there are more limits than tokens', async () => {
        await expect(doSwap(funds, Array(tokenAddresses.length + 1).fill(MAX_INT256), deadline)).to.be.revertedWith(
          'TOKENS_LIMITS_MISMATCH'
        );
      });

      context('with correct limit lenght', () => {
        let deltas: BigNumber[];
        beforeEach('query deltas', async () => {
          deltas = await querySwap(funds);
        });

        context('without withdrawing from internal balance', () => {
          beforeEach(() => {
            funds.fromInternalBalance = false;
          });

          itValidatesCorrectlyWithAndWithoutDepositing();
        });

        context('withdrawing from internal balance', () => {
          beforeEach(() => {
            funds.fromInternalBalance = true;
          });

          itValidatesCorrectlyWithAndWithoutDepositing();
        });

        function itValidatesCorrectlyWithAndWithoutDepositing() {
          context('without depositing to internal balance', () => {
            beforeEach(() => {
              funds.toInternalBalance = false;
            });

            itValidatesCorrectly();
          });

          context('depositing to internal balance', () => {
            beforeEach(() => {
              funds.toInternalBalance = true;
            });

            itValidatesCorrectly();
          });
        }

        function itValidatesCorrectly() {
          context('with limits too low', () => {
            it('reverts', async () => {
              await Promise.all(
                deltas.map((_, i) => {
                  const limits = [...deltas];
                  limits[i] = deltas[i].sub(1);

                  expect(doSwap(funds, limits, deadline)).to.be.revertedWith('SWAP_LIMIT');
                })
              );
            });
          });

          context('with exact limits', () => {
            it('accepts the swap', async () => {
              const receipt = await (await doSwap(funds, deltas, deadline)).wait();
              expectEvent.inReceipt(receipt, 'Swap');
            });
          });

          context('with sufficient limits', () => {
            it('accepts the swap', async () => {
              await Promise.all(
                deltas.map(async (_, i) => {
                  const limits = [...deltas];
                  limits[i] = deltas[i].add(1);

                  const receipt = await (await doSwap(funds, deltas, deadline)).wait();
                  expectEvent.inReceipt(receipt, 'Swap');
                })
              );
            });
          });
        }
      });
    });
  }
});
