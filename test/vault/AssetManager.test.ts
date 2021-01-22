import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../scripts/helpers/deploy';
import * as expectEvent from '../helpers/expectEvent';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { deployTokens, mintTokens, TokenList } from '../helpers/tokens';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '../helpers/constants';
import { PoolOptimizationSetting, SimplifiedQuotePool, StandardPool, TwoTokenPool } from '../../scripts/helpers/pools';

describe('assetManager', function () {
  let tokens: TokenList;
  let otherToken: Contract;
  let vault: Contract;

  let pool: SignerWithAddress;
  let assetManager: SignerWithAddress;
  let other: SignerWithAddress;

  before('deploy base contracts', async () => {
    [, pool, assetManager, other] = await ethers.getSigners();
  });

  beforeEach('set up asset manager', async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await deployTokens(['DAI', 'USDT'], [18, 18]);
    otherToken = await deploy('TestToken', { args: ['OTHER', 'OTHER', 18] });
  });

  describe('asset manager setting', () => {
    let poolId: string;

    beforeEach(async () => {
      const receipt = await (await vault.connect(pool).registerPool(StandardPool)).wait();
      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      poolId = event.args.poolId;
    });

    it('different managers can be set for different tokens', async () => {
      await vault
        .connect(pool)
        .registerTokens(poolId, [tokens.DAI.address, tokens.USDT.address], [assetManager.address, other.address]);

      expect(await vault.getPoolAssetManager(poolId, tokens.DAI.address)).to.equal(assetManager.address);
      expect(await vault.getPoolAssetManager(poolId, tokens.USDT.address)).to.equal(other.address);
    });
  });

  context('with standard pool', () => {
    itManagesAssetsCorrectly(StandardPool);
  });

  context('with simplified pool', () => {
    itManagesAssetsCorrectly(SimplifiedQuotePool);
  });

  context('with two token pool', () => {
    itManagesAssetsCorrectly(TwoTokenPool);
  });

  function itManagesAssetsCorrectly(poolType: PoolOptimizationSetting) {
    let poolId: string;
    const tokenInitialBalance = BigNumber.from((200e18).toString());

    beforeEach(async () => {
      const receipt = await (await vault.connect(pool).registerPool(poolType)).wait();

      const event = expectEvent.inReceipt(receipt, 'PoolCreated');
      poolId = event.args.poolId;

      const tokenAddresses = [];
      const tokenAmounts = [];
      const assetManagers = [];
      for (const symbol in tokens) {
        // Mint tokens for the pool to add liquidity with
        await mintTokens(tokens, symbol, pool, tokenInitialBalance);

        tokenAddresses.push(tokens[symbol].address);
        tokenAmounts.push(tokenInitialBalance);
        assetManagers.push(assetManager.address);

        await tokens[symbol].connect(pool).approve(vault.address, MAX_UINT256);
        await tokens[symbol].connect(assetManager).approve(vault.address, MAX_UINT256);
      }

      await vault.connect(pool).registerTokens(poolId, tokenAddresses, assetManagers);
      await vault.connect(pool).addLiquidity(poolId, pool.address, tokenAddresses, tokenAmounts, false);
    });

    describe('setting', () => {
      it('reverts when querying the asset manager of an unknown pool', async () => {
        const error = 'Nonexistent pool';
        const token = tokens.DAI.address;
        await expect(vault.connect(pool).getPoolAssetManager(ZERO_BYTES32, token)).to.be.revertedWith(error);
        await expect(vault.connect(pool).isPoolAssetManager(ZERO_BYTES32, token, token)).to.be.revertedWith(error);
      });

      it('reverts when querying the asset manager of an unknown token', async () => {
        for (const token of [ZERO_ADDRESS, otherToken.address]) {
          const error = 'ERR_TOKEN_NOT_REGISTERED';
          await expect(vault.connect(pool).getPoolAssetManager(poolId, token)).to.be.revertedWith(error);
          await expect(vault.connect(pool).isPoolAssetManager(poolId, token, other.address)).to.be.revertedWith(error);
        }
      });
    });

    describe('transfer to manager', () => {
      context('when the sender the manager', () => {
        context('when trying to transfer less than the vault balance', () => {
          const amount = BigNumber.from((10e18).toString());

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
            const tokenAddresses = [tokens.DAI.address, tokens.USDT.address];
            const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

            await vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
            expect(currentBalanceDAI).to.equal(previousBalanceDAI);
            expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
          });
        });

        it('reverts when sending more than the pool balance', async () => {
          await expect(
            vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, tokenInitialBalance.add(1))
          ).to.be.revertedWith('ERR_SUB_UNDERFLOW');
        });
      });

      it('reverts if the sender is not the manager', async () => {
        await expect(vault.connect(other).withdrawFromPoolBalance(poolId, tokens.DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_ASSET_MANAGER'
        );
      });
    });

    describe('divest', () => {
      context('when the sender is an allowed manager', () => {
        context('when trying to move less than the managed balance', () => {
          const externalAmount = BigNumber.from((75e18).toString());
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
            const tokenAddresses = [tokens.DAI.address, tokens.USDT.address];
            const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

            await vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
            expect(currentBalanceDAI).to.equal(previousBalanceDAI);
            expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
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
        const externalAmount = BigNumber.from((10e18).toString());

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
            const tokenAddresses = [tokens.DAI.address, tokens.USDT.address];
            const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
            expect(currentBalanceDAI).to.equal(previousBalanceDAI.add(1));
            expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
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
            const tokenAddresses = [tokens.DAI.address, tokens.USDT.address];
            const [previousBalanceDAI, previousBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceUSDT] = await vault.getPoolTokenBalances(poolId, tokenAddresses);
            expect(currentBalanceDAI).to.equal(previousBalanceDAI.sub(1));
            expect(currentBalanceUSDT).to.equal(previousBalanceUSDT);
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
        expect(await vault.getPoolAssetManager(poolId, tokens.USDT.address)).to.equal(assetManager.address);

        // Balances must be zero to unregister
        await vault
          .connect(pool)
          .removeLiquidity(
            poolId,
            pool.address,
            [tokens.DAI.address, tokens.USDT.address],
            [tokenInitialBalance, tokenInitialBalance],
            false
          );

        // Unregistering tokens should remove the asset managers
        await vault.connect(pool).unregisterTokens(poolId, [tokens.DAI.address, tokens.USDT.address]);

        for (const symbol in tokens) {
          const token = tokens[symbol].address;
          const error = 'ERR_TOKEN_NOT_REGISTERED';
          await expect(vault.getPoolAssetManager(poolId, token)).to.be.revertedWith(error);
          await expect(vault.isPoolAssetManager(poolId, token, assetManager.address)).to.be.revertedWith(error);
        }

        // Should also be able to re-register (just one in this case)
        await vault
          .connect(pool)
          .registerTokens(poolId, [tokens.DAI.address, tokens.USDT.address], [assetManager.address, ZERO_ADDRESS]);

        expect(await vault.getPoolAssetManager(poolId, tokens.DAI.address)).to.equal(assetManager.address);
        expect(await vault.isPoolAssetManager(poolId, tokens.DAI.address, assetManager.address)).to.be.true;
        expect(await vault.isPoolAssetManager(poolId, tokens.DAI.address, other.address)).to.be.false;

        expect(await vault.getPoolAssetManager(poolId, tokens.USDT.address)).to.equal(ZERO_ADDRESS);
      });
    });
  }
});
