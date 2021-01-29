import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { bn } from '../../lib/helpers/numbers';
import { deploy } from '../../lib/helpers/deploy';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { deploySortedTokens, mintTokens, TokenList } from '../../lib/helpers/tokens';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '../../lib/helpers/constants';
import { MinimalSwapInfoPool, PoolSpecializationSetting, GeneralPool, TwoTokenPool } from '../../lib/helpers/pools';

describe('Vault - asset manager', function () {
  let tokens: TokenList, otherToken: Contract, vault: Contract;
  let lp: SignerWithAddress, assetManager: SignerWithAddress, other: SignerWithAddress;

  before('deploy base contracts', async () => {
    [, lp, assetManager, other] = await ethers.getSigners();
  });

  beforeEach('set up asset manager', async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await deploySortedTokens(['DAI', 'USDT'], [18, 18]);
    otherToken = await deploy('TestToken', { args: [other.address, 'OTHER', 'OTHER', 18] });
  });

  context('with general pool', () => {
    itManagesAssetsCorrectly(GeneralPool);
  });

  context('with minimal swap info pool', () => {
    itManagesAssetsCorrectly(MinimalSwapInfoPool);
  });

  context('with two token pool', () => {
    itManagesAssetsCorrectly(TwoTokenPool);
  });

  function itManagesAssetsCorrectly(specialization: PoolSpecializationSetting) {
    let poolId: string;
    const tokenInitialBalance = bn(200e18);

    beforeEach('deploy pool and add liquidity', async () => {
      const pool = await deploy('MockPool', { args: [vault.address, specialization] });
      poolId = await pool.getPoolId();

      const tokenAddresses = [];
      for (const symbol in tokens) {
        // Mint tokens for the lp to join the Pool with
        await mintTokens(tokens, symbol, lp, tokenInitialBalance);

        tokenAddresses.push(tokens[symbol].address);

        await tokens[symbol].connect(lp).approve(vault.address, MAX_UINT256);
        await tokens[symbol].connect(assetManager).approve(vault.address, MAX_UINT256);
      }

      // Assign assetManager to the DAI token, and other to the other token
      const assetManagers = [assetManager.address, other.address];

      await pool.registerTokens(tokenAddresses, assetManagers);

      await pool.setOnJoinExitPoolReturnValues(
        tokenAddresses.map(() => tokenInitialBalance),
        tokenAddresses.map(() => 0)
      );

      await vault.connect(lp).joinPool(
        poolId,
        other.address,
        tokenAddresses,
        tokenAddresses.map(() => MAX_UINT256),
        false,
        '0x'
      );
    });

    describe('setting', () => {
      it('different managers can be set for different tokens', async () => {
        expect(await vault.getPoolAssetManager(poolId, tokens.DAI.address)).to.equal(assetManager.address);
        expect(await vault.getPoolAssetManager(poolId, tokens.USDT.address)).to.equal(other.address);
      });

      it('reverts when querying the asset manager of an unknown pool', async () => {
        const error = 'Nonexistent pool';
        const token = tokens.DAI.address;
        await expect(vault.getPoolAssetManager(ZERO_BYTES32, token)).to.be.revertedWith(error);
      });

      it('reverts when querying the asset manager of an unknown token', async () => {
        for (const token of [ZERO_ADDRESS, otherToken.address]) {
          const error = 'ERR_TOKEN_NOT_REGISTERED';
          await expect(vault.getPoolAssetManager(poolId, token)).to.be.revertedWith(error);
        }
      });
    });

    describe('transfer to manager', () => {
      context('when the sender the manager', () => {
        context('when trying to transfer less than the vault balance', () => {
          const amount = bn(10e18);

          it('transfers only the requested token from the vault to the manager', async () => {
            await expectBalanceChange(
              () => vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, amount),
              tokens,
              [
                { account: assetManager, changes: { DAI: amount } },
                { account: vault, changes: { DAI: -amount } },
              ]
            );
          });

          it('does not affect the balance of the pools', async () => {
            const [previousBalanceDAI, previousBalanceUSDT] = (await vault.getPoolTokens(poolId)).balances;

            await vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceUSDT] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI);
            expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
          });

          it('moves the balance from cash to managed', async () => {
            const previousBalance = await vault.getPoolTokenBalanceInfo(poolId, tokens.DAI.address);

            await vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, amount);

            const currentBalance = await vault.getPoolTokenBalanceInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash.sub(amount));
            expect(currentBalance.managed).to.equal(previousBalance.managed.add(amount));
          });
        });

        it('reverts when sending more than the pool balance', async () => {
          await expect(
            vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, tokenInitialBalance.add(1))
          ).to.be.revertedWith('ERR_SUB_OVERFLOW');
        });
      });

      it('reverts if the sender is not the manager', async () => {
        await expect(vault.connect(other).withdrawFromPoolBalance(poolId, tokens.DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_ASSET_MANAGER'
        );
      });
    });

    describe('deposit to pool', () => {
      context('when the sender is an allowed manager', () => {
        context('when trying to move less than the managed balance', () => {
          const externalAmount = bn(75e18);
          const amount = externalAmount.div(2);

          beforeEach('put under management', async () => {
            await vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, externalAmount);
          });

          it('transfers only the requested token from the manager to the vault', async () => {
            await expectBalanceChange(
              () => vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, amount),
              tokens,
              [
                { account: assetManager, changes: { DAI: -amount } },
                { account: vault, changes: { DAI: amount } },
              ]
            );
          });

          it('does not affect the balance of the pools', async () => {
            const [previousBalanceDAI, previousBalanceUSDT] = (await vault.getPoolTokens(poolId)).balances;

            await vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceUSDT] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI);
            expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
          });

          it('moves the balance from managed to cash', async () => {
            const previousBalance = await vault.getPoolTokenBalanceInfo(poolId, tokens.DAI.address);

            await vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, amount);

            const currentBalance = await vault.getPoolTokenBalanceInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash.add(amount));
            expect(currentBalance.managed).to.equal(previousBalance.managed.sub(amount));
          });
        });

        it('does nothing when divesting zero tokens', async () => {
          await expectBalanceChange(
            () => vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, 0),
            tokens,
            { account: vault.address }
          );
        });

        it('reverts when cashing out more than the managed balance', async () => {
          await expect(
            vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, 1)
          ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });
      });

      it('reverts if the sender is not the manager', async () => {
        await expect(vault.connect(other).depositToPoolBalance(poolId, tokens.DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_ASSET_MANAGER'
        );
      });
    });

    describe('update', () => {
      context('when the sender is an allowed manager', () => {
        const externalAmount = bn(10e18);

        beforeEach('transfer to manager', async () => {
          await vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, externalAmount);
        });

        context('with gains', () => {
          const amount = externalAmount.add(1);

          it('does not affect token balances', async () => {
            await expectBalanceChange(
              () => vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount),
              tokens,
              [{ account: assetManager }, { account: vault }]
            );
          });

          it('updates the balance of the pool', async () => {
            const [previousBalanceDAI, previousBalanceUSDT] = (await vault.getPoolTokens(poolId)).balances;

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceUSDT] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI.add(1));
            expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
          });

          it('sets the managed balance', async () => {
            const previousBalance = await vault.getPoolTokenBalanceInfo(poolId, tokens.DAI.address);

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const currentBalance = await vault.getPoolTokenBalanceInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash);
            expect(currentBalance.managed).to.equal(amount);
          });
        });

        context('with losses', () => {
          const amount = externalAmount.sub(1);

          it('does not affect token balances', async () => {
            await expectBalanceChange(
              () => vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount),
              tokens,
              [{ account: assetManager }, { account: vault }]
            );
          });

          it('updates the balance of the pool', async () => {
            const [previousBalanceDAI, previousBalanceUSDT] = (await vault.getPoolTokens(poolId)).balances;

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceUSDT] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI.sub(1));
            expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
          });

          it('sets the managed balance', async () => {
            const previousBalance = await vault.getPoolTokenBalanceInfo(poolId, tokens.DAI.address);

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const currentBalance = await vault.getPoolTokenBalanceInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash);
            expect(currentBalance.managed).to.equal(amount);
          });
        });
      });

      it('revert if the sender is not the manager', async () => {
        await expect(vault.connect(other).updateManagedBalance(poolId, tokens.DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_ASSET_MANAGER'
        );
      });

      it('removes asset managers when unregistering', async () => {
        // First asset the managers are set
        expect(await vault.getPoolAssetManager(poolId, tokens.DAI.address)).to.equal(assetManager.address);
        expect(await vault.getPoolAssetManager(poolId, tokens.USDT.address)).to.equal(other.address);

        const [poolAddress] = await vault.getPool(poolId);
        const pool = await ethers.getContractAt('MockPool', poolAddress);

        const { tokens: poolTokens, balances } = await vault.getPoolTokens(poolId);

        // Balances must be zero to unregister, so we do a full exit
        await pool.setOnJoinExitPoolReturnValues(balances, Array(poolTokens.length).fill(0));

        await vault.connect(lp).exitPool(poolId, lp.address, poolTokens, Array(poolTokens.length).fill(0), false, '0x');

        // Unregistering tokens should remove the asset managers
        await pool.unregisterTokens([tokens.DAI.address, tokens.USDT.address]);

        for (const symbol in tokens) {
          const token = tokens[symbol].address;
          const error = 'ERR_TOKEN_NOT_REGISTERED';
          await expect(vault.getPoolAssetManager(poolId, token)).to.be.revertedWith(error);
        }

        // Should also be able to re-register (just one in this case)
        await pool.registerTokens([tokens.DAI.address, tokens.USDT.address], [assetManager.address, ZERO_ADDRESS]);

        expect(await vault.getPoolAssetManager(poolId, tokens.DAI.address)).to.equal(assetManager.address);
        expect(await vault.getPoolAssetManager(poolId, tokens.USDT.address)).to.equal(ZERO_ADDRESS);
      });
    });
  }
});
