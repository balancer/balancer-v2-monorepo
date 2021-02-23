import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Token from '../helpers/models/tokens/Token';
import TokenList from '../helpers/models/tokens/TokenList';
import { expectBalanceChange } from '../helpers/tokenBalance';
import { encodeExit, encodeJoin } from '../helpers/mockPool';

import { bn } from '../../lib/helpers/numbers';
import { deploy } from '../../lib/helpers/deploy';
import { MAX_UINT256, ZERO_ADDRESS, ZERO_BYTES32 } from '../../lib/helpers/constants';
import { GeneralPool, MinimalSwapInfoPool, PoolSpecializationSetting, TwoTokenPool } from '../../lib/helpers/pools';

describe('Vault - asset manager', function () {
  let tokens: TokenList, otherToken: Token, vault: Contract;
  let lp: SignerWithAddress, assetManager: SignerWithAddress, other: SignerWithAddress;

  before('deploy base contracts', async () => {
    [, lp, assetManager, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager', async () => {
    vault = await deploy('Vault', { args: [ZERO_ADDRESS] });
    tokens = await TokenList.create(['DAI', 'MKR'], { sorted: true });
    otherToken = await Token.create('OTHER');
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

    sharedBeforeEach('deploy pool and add liquidity', async () => {
      const pool = await deploy('MockPool', { args: [vault.address, specialization] });
      poolId = await pool.getPoolId();

      await tokens.mint({ to: lp, amount: tokenInitialBalance });
      await tokens.approve({ to: vault, from: [lp, assetManager] });

      // Assign assetManager to the DAI token, and other to the other token
      const assetManagers = [assetManager.address, other.address];

      await pool.registerTokens(tokens.addresses, assetManagers);

      await vault.connect(lp).joinPool(
        poolId,
        lp.address,
        other.address,
        tokens.addresses,
        tokens.addresses.map(() => MAX_UINT256),
        false,
        encodeJoin(
          tokens.addresses.map(() => tokenInitialBalance),
          tokens.addresses.map(() => 0)
        )
      );
    });

    describe('setting', () => {
      it('different managers can be set for different tokens', async () => {
        expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
        expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(other.address);
      });

      it('reverts when querying the asset manager of an unknown pool', async () => {
        const error = 'INVALID_POOL_ID';
        const token = tokens.DAI.address;
        await expect(vault.getPoolTokenInfo(ZERO_BYTES32, token)).to.be.revertedWith(error);
      });

      it('reverts when querying the asset manager of an unknown token', async () => {
        for (const token of [ZERO_ADDRESS, otherToken.address]) {
          const error = 'TOKEN_NOT_REGISTERED';
          await expect(vault.getPoolTokenInfo(poolId, token)).to.be.revertedWith(error);
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
            const [previousBalanceDAI, previousBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;

            await vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI);
            expect(currentBalanceMKR).to.equal(previousBalanceMKR);
          });

          it('moves the balance from cash to managed', async () => {
            const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

            await vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, amount);

            const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash.sub(amount));
            expect(currentBalance.managed).to.equal(previousBalance.managed.add(amount));
            expect(currentBalance.blockNumber).to.equal(previousBalance.blockNumber);
          });
        });

        context('when trying to send more than the pool balance', () => {
          const amount = tokenInitialBalance.add(1);

          it('reverts', async () => {
            const withdraw = vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, amount);
            await expect(withdraw).to.be.revertedWith('SUB_OVERFLOW');
          });
        });
      });

      context('when the sender is not the manager', () => {
        it('reverts', async () => {
          const withdraw = vault.connect(other).withdrawFromPoolBalance(poolId, tokens.DAI.address, 0);
          await expect(withdraw).to.be.revertedWith('SENDER_NOT_ASSET_MANAGER');
        });
      });
    });

    describe('deposit to pool', () => {
      context('when the sender is an allowed manager', () => {
        const externalAmount = bn(75e18);

        sharedBeforeEach('withdraw funds', async () => {
          await vault.connect(assetManager).withdrawFromPoolBalance(poolId, tokens.DAI.address, externalAmount);
        });

        context('when trying to move less than the managed balance', () => {
          const amount = externalAmount.div(2);

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
            const [previousBalanceDAI, previousBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;

            await vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI);
            expect(currentBalanceMKR).to.equal(previousBalanceMKR);
          });

          it('moves the balance from managed to cash', async () => {
            const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

            await vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, amount);

            const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash.add(amount));
            expect(currentBalance.managed).to.equal(previousBalance.managed.sub(amount));
            expect(currentBalance.blockNumber).to.equal(previousBalance.blockNumber);
          });
        });

        context('when cashing out more than the managed balance', () => {
          const amount = externalAmount.add(2);

          it('reverts', async () => {
            const deposit = vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, amount);
            await expect(deposit).to.be.revertedWith('SUB_OVERFLOW');
          });
        });

        context('when trying divest a zeroed amount', () => {
          const amount = 0;

          it('ignores the request', async () => {
            await expectBalanceChange(
              () => vault.connect(assetManager).depositToPoolBalance(poolId, tokens.DAI.address, amount),
              tokens,
              { account: vault.address }
            );
          });
        });
      });

      context('when the sender is not an allowed manager', () => {
        it('reverts', async () => {
          const deposit = vault.connect(other).depositToPoolBalance(poolId, tokens.DAI.address, 0);
          await expect(deposit).to.be.revertedWith('SENDER_NOT_ASSET_MANAGER');
        });
      });
    });

    describe('update', () => {
      context('when the sender is an allowed manager', () => {
        const externalAmount = bn(10e18);

        sharedBeforeEach('transfer to manager', async () => {
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
            const [previousBalanceDAI, previousBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI.add(1));
            expect(currentBalanceMKR).to.equal(previousBalanceMKR);
          });

          it('sets the managed balance', async () => {
            const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash);
            expect(currentBalance.managed).to.equal(amount);

            const currentBlockNumber = await ethers.provider.getBlockNumber();
            expect(currentBalance.blockNumber).to.equal(currentBlockNumber);
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
            const [previousBalanceDAI, previousBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const [currentBalanceDAI, currentBalanceMKR] = (await vault.getPoolTokens(poolId)).balances;
            expect(currentBalanceDAI).to.equal(previousBalanceDAI.sub(1));
            expect(currentBalanceMKR).to.equal(previousBalanceMKR);
          });

          it('sets the managed balance', async () => {
            const previousBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);

            await vault.connect(assetManager).updateManagedBalance(poolId, tokens.DAI.address, amount);

            const currentBalance = await vault.getPoolTokenInfo(poolId, tokens.DAI.address);
            expect(currentBalance.cash).to.equal(previousBalance.cash);
            expect(currentBalance.managed).to.equal(amount);

            const currentBlockNumber = await ethers.provider.getBlockNumber();
            expect(currentBalance.blockNumber).to.equal(currentBlockNumber);
          });
        });
      });

      it('revert if the sender is not the manager', async () => {
        await expect(vault.connect(other).updateManagedBalance(poolId, tokens.DAI.address, 0)).to.be.revertedWith(
          'SENDER_NOT_ASSET_MANAGER'
        );
      });

      it('removes asset managers when deregistering', async () => {
        // First asset the managers are set
        expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
        expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(other.address);

        const [poolAddress] = await vault.getPool(poolId);
        const pool = await ethers.getContractAt('MockPool', poolAddress);

        const { tokens: poolTokens, balances } = await vault.getPoolTokens(poolId);

        // Balances must be zero to deregister, so we do a full exit
        await vault
          .connect(lp)
          .exitPool(
            poolId,
            lp.address,
            lp.address,
            poolTokens,
            Array(poolTokens.length).fill(0),
            false,
            encodeExit(balances, Array(poolTokens.length).fill(0))
          );

        // Deregistering tokens should remove the asset managers
        await pool.deregisterTokens([tokens.DAI.address, tokens.MKR.address]);

        await tokens.asyncEach(async (token: Token) => {
          await expect(vault.getPoolTokenInfo(poolId, token.address)).to.be.revertedWith('TOKEN_NOT_REGISTERED');
        });

        // Should also be able to re-register (just one in this case)
        await pool.registerTokens([tokens.DAI.address, tokens.MKR.address], [assetManager.address, ZERO_ADDRESS]);

        expect((await vault.getPoolTokenInfo(poolId, tokens.DAI.address)).assetManager).to.equal(assetManager.address);
        expect((await vault.getPoolTokenInfo(poolId, tokens.MKR.address)).assetManager).to.equal(ZERO_ADDRESS);
      });
    });
  }
});
