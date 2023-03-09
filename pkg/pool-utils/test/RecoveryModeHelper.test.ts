import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import { randomAddress, ZERO_ADDRESS, ZERO_BYTES32 } from '@balancer-labs/v2-helpers/src/constants';
import { BasePoolEncoder, PoolSpecialization } from '@balancer-labs/balancer-js';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { random } from 'lodash';

describe('RecoveryModeHelper', function () {
  let vault: Vault;
  let helper: Contract;

  sharedBeforeEach('deploy vault & tokens', async () => {
    // We use a mocked Vault, as that lets us more easily mock cash and managed balances
    vault = await Vault.create({ mocked: true });
  });

  sharedBeforeEach('deploy helper', async () => {
    helper = await deploy('RecoveryModeHelper', { args: [vault.address] });
  });

  it("returns the vault's address", async () => {
    expect(await helper.getVault()).to.equal(vault.address);
  });

  describe('calcComposableRecoveryAmountsOut', () => {
    it('reverts if the poolId is invalid', async () => {
      // This revert mode only happens with the real Vault, so we deploy one here for this test
      const realVault = await Vault.create({});
      const realHelper = await deploy('RecoveryModeHelper', { args: [realVault.address] });
      await expect(realHelper.calcComposableRecoveryAmountsOut(ZERO_BYTES32, '0x', 0)).to.be.revertedWith(
        'INVALID_POOL_ID'
      );
    });

    it('reverts if the pool has no registered tokens', async () => {
      // ComposablePools always have at least one token registered (the BPT)
      const pool = await deploy('v2-vault/MockPool', { args: [vault.address, PoolSpecialization.GeneralPool] });
      await expect(helper.calcComposableRecoveryAmountsOut(await pool.getPoolId(), '0x', 0)).to.be.reverted;
    });

    it('reverts if the user data is not a recovery mode exit', async () => {
      const pool = await deploy('v2-vault/MockPool', { args: [vault.address, PoolSpecialization.GeneralPool] });
      await pool.registerTokens([randomAddress()], [ZERO_ADDRESS]);

      await expect(helper.calcComposableRecoveryAmountsOut(await pool.getPoolId(), '0xdeadbeef', 0)).to.be.reverted;
    });

    describe('with valid poolId and user data', () => {
      let pool: Contract;
      let poolId: string;
      let tokens: TokenList;

      const totalSupply = fp(150);
      const virtualSupply = fp(100);
      const bptAmountIn = fp(20); // 20% of the virtual supply

      sharedBeforeEach('deploy mock pool', async () => {
        pool = await deploy('v2-vault/MockPool', { args: [vault.address, PoolSpecialization.GeneralPool] });
        poolId = await pool.getPoolId();
      });

      sharedBeforeEach('register tokens', async () => {
        tokens = await TokenList.create(5);

        // ComposablePools register BPT as the first token
        const poolTokens = [pool.address, ...tokens.addresses];
        await pool.registerTokens(
          poolTokens,
          poolTokens.map(() => ZERO_ADDRESS)
        );
      });

      describe('with no managed balance', async () => {
        let balances: Array<BigNumber>;

        sharedBeforeEach('set cash', async () => {
          balances = tokens.map(() => fp(random(1, 50)));

          // The first token is BPT, and its Pool balance is the difference between total and virtual supply (i.e. the
          // preminted tokens).
          await vault.updateCash(poolId, [totalSupply.sub(virtualSupply), ...balances]);
          await vault.updateManaged(poolId, [0, ...tokens.map(() => 0)]);
        });

        it('returns the encoded BPT amount in', async () => {
          const { bptAmountIn: actualBptAmountIn } = await helper.calcComposableRecoveryAmountsOut(
            poolId,
            BasePoolEncoder.recoveryModeExit(bptAmountIn),
            totalSupply
          );

          expect(actualBptAmountIn).to.equal(bptAmountIn);
        });

        it('returns proportional amounts out', async () => {
          const { amountsOut: actualAmountsOut } = await helper.calcComposableRecoveryAmountsOut(
            poolId,
            BasePoolEncoder.recoveryModeExit(bptAmountIn),
            totalSupply
          );

          // bptAmountIn corresponds to 20% of the virtual supply
          const expectedTokenAmountsOut = balances.map((amount) => amount.div(5));
          // The first token in a Composable Pool is BPT
          const expectedAmountsOut = [0, ...expectedTokenAmountsOut];

          expect(actualAmountsOut).to.deep.equal(expectedAmountsOut);
        });
      });

      describe('with managed balance', async () => {
        let cashBalances: Array<BigNumber>;
        let managedBalances: Array<BigNumber>;

        sharedBeforeEach('set balances', async () => {
          cashBalances = tokens.map(() => fp(random(1, 50)));
          managedBalances = tokens.map(() => fp(random(1, 50)));

          // The first token is BPT, and its Pool balance is the difference between total and virtual supply (i.e. the
          // preminted tokens).
          await vault.updateCash(poolId, [totalSupply.sub(virtualSupply), ...cashBalances]);
          // There's no managed balance for BPT
          await vault.updateManaged(poolId, [0, ...managedBalances]);
        });

        it('returns the encoded BPT amount in', async () => {
          const { bptAmountIn: actualBptAmountIn } = await helper.calcComposableRecoveryAmountsOut(
            poolId,
            BasePoolEncoder.recoveryModeExit(bptAmountIn),
            totalSupply
          );

          expect(actualBptAmountIn).to.equal(bptAmountIn);
        });

        it('returns proportional cash amounts out', async () => {
          const { amountsOut: actualAmountsOut } = await helper.calcComposableRecoveryAmountsOut(
            poolId,
            BasePoolEncoder.recoveryModeExit(bptAmountIn),
            totalSupply
          );

          // bptAmountIn corresponds to 20% of the virtual supply
          const expectedTokenAmountsOut = cashBalances.map((amount) => amount.div(5));
          // The first token in a Composable Pool is BPT
          const expectedAmountsOut = [0, ...expectedTokenAmountsOut];

          expect(actualAmountsOut).to.deep.equal(expectedAmountsOut);
        });
      });
    });
  });
});
