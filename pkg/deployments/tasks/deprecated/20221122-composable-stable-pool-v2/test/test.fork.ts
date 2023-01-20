import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { describeForkTest } from '../../../../src/forkTests';
import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { getSigner, impersonate } from '../../../../src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { BasePoolEncoder, StablePoolEncoder, SwapKind } from '@balancer-labs/balancer-js';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';

describeForkTest('ComposableStablePool', 'mainnet', 16000000, function () {
  let task: Task;

  let factory: Contract;
  let owner: SignerWithAddress;
  let whale: SignerWithAddress;
  let govMultisig: SignerWithAddress;
  let vault: Contract;
  let authorizer: Contract;
  let busd: Contract;
  let usdt: Contract;

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const LARGE_TOKEN_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';
  const USDT_SCALING = bn(1e12); // USDT has 6 decimals, so its scaling factor is 1e12

  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const BUSD = '0x4Fabb145d64652a948d72533023f6E7A623C7C53';

  const tokens = [BUSD, USDT];
  const amplificationParameter = bn(400);
  const swapFeePercentage = fp(0.01);
  const initialBalanceBUSD = fp(1e6);
  const initialBalanceUSDT = fp(1e6).div(USDT_SCALING);
  const initialBalances = [initialBalanceBUSD, initialBalanceUSDT];

  before('run task', async () => {
    task = new Task('20221122-composable-stable-pool-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    factory = await task.deployedInstance('ComposableStablePoolFactory');
  });

  before('load signers', async () => {
    owner = await getSigner();
    whale = await impersonate(LARGE_TOKEN_HOLDER, fp(100));

    govMultisig = await impersonate(GOV_MULTISIG, fp(100));
  });

  before('load vault and tokens', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.instanceAt('Vault', await factory.getVault());
    authorizer = await new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance(
      'Authorizer'
    );

    busd = await task.instanceAt('ERC20', BUSD);
    usdt = await task.instanceAt('ERC20', USDT);

    await busd.connect(whale).approve(vault.address, MAX_UINT256);
    await usdt.connect(whale).approve(vault.address, MAX_UINT256);
  });

  async function createPool(tokens: string[], initialize = true): Promise<Contract> {
    const rateProviders: string[] = Array(tokens.length).fill(ZERO_ADDRESS);
    const cacheDurations: BigNumber[] = Array(tokens.length).fill(bn(0));
    const exemptFlags: boolean[] = Array(tokens.length).fill(false);

    const tx = await factory.create(
      'CSP',
      'CSBPT',
      tokens,
      amplificationParameter,
      rateProviders,
      cacheDurations,
      exemptFlags,
      swapFeePercentage,
      owner.address
    );

    const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');
    const pool = await task.instanceAt('ComposableStablePool', event.args.pool);
    expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

    if (initialize) {
      const bptIndex = await pool.getBptIndex();
      const poolId = await pool.getPoolId();

      const registeredBalances = getRegisteredBalances(bptIndex, initialBalances);
      const { tokens: registeredTokens } = await vault.getPoolTokens(poolId);

      const userData = StablePoolEncoder.joinInit(registeredBalances);
      // Use this for maxAmountsIn
      registeredBalances[bptIndex] = MAX_UINT256;

      await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
        assets: registeredTokens,
        maxAmountsIn: registeredBalances,
        fromInternalBalance: false,
        userData,
      });
    }

    return pool;
  }

  function getRegisteredBalances(bptIndex: number, balances: BigNumber[]): BigNumber[] {
    return Array.from({ length: balances.length + 1 }).map((_, i) =>
      i == bptIndex ? bn(0) : i < bptIndex ? balances[i] : balances[i - 1]
    );
  }

  describe('getters', () => {
    it('check factory version', async () => {
      const expectedFactoryVersion = {
        name: 'ComposableStablePoolFactory',
        version: 2,
        deployment: '20221122-composable-stable-pool-v2',
      };

      expect(await factory.version()).to.equal(JSON.stringify(expectedFactoryVersion));
    });

    it('check pool version', async () => {
      const pool = await createPool(tokens);

      const expectedPoolVersion = {
        name: 'ComposableStablePool',
        version: 2,
        deployment: '20221122-composable-stable-pool-v2',
      };

      expect(await pool.version()).to.equal(JSON.stringify(expectedPoolVersion));
    });
  });

  describe('pool operations', () => {
    const amount = fp(500);

    let pool: Contract;
    let poolId: string;
    let bptIndex: number;

    context('swap', () => {
      before('deploy a composable stable pool', async () => {
        expect(await factory.isPoolFromFactory(ZERO_ADDRESS)).to.be.false;

        pool = await createPool(tokens);

        poolId = pool.getPoolId();
        const [registeredAddress] = await vault.getPool(poolId);
        expect(registeredAddress).to.equal(pool.address);

        bptIndex = await pool.getBptIndex();
      });

      it('performs a swap', async () => {
        await busd.connect(whale).transfer(owner.address, amount);
        await busd.connect(owner).approve(vault.address, amount);

        await vault
          .connect(owner)
          .swap(
            { kind: SwapKind.GivenIn, poolId, assetIn: BUSD, assetOut: USDT, amount, userData: '0x' },
            { sender: owner.address, recipient: owner.address, fromInternalBalance: false, toInternalBalance: false },
            0,
            MAX_UINT256
          );

        // Assert pool swap
        const expectedUSDT = amount.div(USDT_SCALING);
        expectEqualWithError(await busd.balanceOf(owner.address), 0, 0.0001);
        expectEqualWithError(await usdt.balanceOf(owner.address), bn(expectedUSDT), 0.1);
      });
    });

    context('proportional join', () => {
      before('deploy a composable stable pool', async () => {
        expect(await factory.isPoolFromFactory(ZERO_ADDRESS)).to.be.false;

        pool = await createPool(tokens);

        poolId = pool.getPoolId();
        const [registeredAddress] = await vault.getPool(poolId);
        expect(registeredAddress).to.equal(pool.address);

        bptIndex = await pool.getBptIndex();
      });

      it('joins proportionally', async () => {
        const ownerBptBalance = await pool.balanceOf(owner.address);
        const bptOut = ownerBptBalance.div(5);

        const { tokens: registeredTokens } = await vault.getPoolTokens(poolId);
        // Given the bptOut, the max amounts in should be slightly more than 1/5. Decimals make it a bit complicated.
        const adjustedBalances = [
          initialBalanceBUSD.div(fp(4.99)).mul(fp(1)),
          initialBalanceUSDT.div(bn(4.99e6)).mul(1e6),
        ];
        const maxAmountsIn = getRegisteredBalances(bptIndex, adjustedBalances);

        const tx = await vault.connect(whale).joinPool(poolId, whale.address, whale.address, {
          assets: registeredTokens,
          maxAmountsIn: maxAmountsIn,
          fromInternalBalance: false,
          userData: StablePoolEncoder.joinAllTokensInForExactBptOut(bptOut),
        });
        const receipt = await (await tx).wait();
        const { deltas: amountsIn } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;

        // Amounts in should be ~ 1/5 the initial balances
        expect(amountsIn).to.equalWithError(maxAmountsIn, 0.01);

        // Make sure received BPT is close to what we expect
        const currentBptBalance = await pool.balanceOf(whale.address);
        expect(currentBptBalance).to.be.equalWithError(bptOut, 0.001);
      });
    });

    context('proportional exit', () => {
      before('deploy a composable stable pool', async () => {
        expect(await factory.isPoolFromFactory(ZERO_ADDRESS)).to.be.false;

        pool = await createPool(tokens);

        poolId = pool.getPoolId();
        const [registeredAddress] = await vault.getPool(poolId);
        expect(registeredAddress).to.equal(pool.address);

        bptIndex = await pool.getBptIndex();
      });

      it('exits proportionally', async () => {
        const previousBptBalance = await pool.balanceOf(owner.address);
        const bptIn = previousBptBalance.div(4);

        const { tokens: registeredTokens, balances: registeredBalances } = await vault.getPoolTokens(poolId);

        const tx = await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
          assets: registeredTokens,
          minAmountsOut: Array(registeredTokens.length).fill(0),
          fromInternalBalance: false,
          userData: StablePoolEncoder.exitExactBptInForTokensOut(bptIn),
        });
        const receipt = await (await tx).wait();
        const { deltas } = expectEvent.inReceipt(receipt, 'PoolBalanceChanged').args;
        const amountsOut = deltas.map((x: BigNumber) => x.mul(-1));

        const expectedAmountsOut = (registeredBalances as BigNumber[]).map((b) => b.div(4));
        expectedAmountsOut[bptIndex] = bn(0);

        // Amounts out should be 1/4 the initial balances
        expect(amountsOut).to.equalWithError(expectedAmountsOut, 0.00001);

        // Make sure sent BPT is close to what we expect
        const currentBptBalance = await pool.balanceOf(owner.address);
        expect(currentBptBalance).to.be.equalWithError(bn(previousBptBalance).sub(bptIn), 0.001);
      });
    });
  });

  describe('recovery mode', () => {
    let pool: Contract;
    let poolId: string;

    before('deploy and initialize a composable stable pool', async () => {
      pool = await createPool(tokens);
      poolId = await pool.getPoolId();
    });

    before('enter recovery mode', async () => {
      await authorizer.connect(govMultisig).grantRole(await actionId(pool, 'enableRecoveryMode'), govMultisig.address);
      await pool.connect(govMultisig).enableRecoveryMode();
      expect(await pool.inRecoveryMode()).to.be.true;
    });

    it('can exit via recovery mode', async () => {
      const bptBalance = await pool.balanceOf(owner.address);
      expect(bptBalance).to.gt(0);

      const vaultUSDTBalanceBeforeExit = await usdt.balanceOf(vault.address);
      const ownerUSDTBalanceBeforeExit = await usdt.balanceOf(owner.address);

      const { tokens: registeredTokens } = await vault.getPoolTokens(poolId);

      const userData = BasePoolEncoder.recoveryModeExit(bptBalance);
      await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
        assets: registeredTokens,
        minAmountsOut: Array(registeredTokens.length).fill(0),
        fromInternalBalance: false,
        userData,
      });

      const remainingBalance = await pool.balanceOf(owner.address);
      expect(remainingBalance).to.equal(0);

      const vaultUSDTBalanceAfterExit = await usdt.balanceOf(vault.address);
      const ownerUSDTBalanceAfterExit = await usdt.balanceOf(owner.address);

      expect(vaultUSDTBalanceAfterExit).to.lt(vaultUSDTBalanceBeforeExit);
      expect(ownerUSDTBalanceAfterExit).to.gt(ownerUSDTBalanceBeforeExit);
    });
  });

  describe('factory disable', () => {
    it('the factory can be disabled', async () => {
      await authorizer.connect(govMultisig).grantRole(await actionId(factory, 'disable'), govMultisig.address);
      await factory.connect(govMultisig).disable();

      expect(await factory.isDisabled()).to.be.true;
      await expect(
        factory.create(
          'CSP',
          'CSBPT',
          tokens,
          amplificationParameter,
          Array(tokens.length).fill(ZERO_ADDRESS),
          Array(tokens.length).fill(0),
          Array(tokens.length).fill(false),
          swapFeePercentage,
          owner.address
        )
      ).to.be.revertedWith('BAL#211');
    });
  });
});
