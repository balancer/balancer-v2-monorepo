import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StablePoolEncoder } from '@balancer-labs/balancer-js';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { describeForkTest, getSigner, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';
import {
  DAI,
  USDC,
  amplificationParameter,
  cacheDurations,
  exemptFlags,
  rateProviders,
  swapFeePercentage,
  tokens,
  initialBalances,
  initialBalanceDAI,
  initialBalanceUSDC,
} from './helpers/sharedStableParams';

describeForkTest('BatchRelayerLibrary - Composable Stable V2+', 'mainnet', 16789433, function () {
  let task: Task;

  //let relayer: Contract, library: Contract;
  let vault: Contract;

  before('run task', async () => {
    task = new Task('20230314-batch-relayer-v5', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    // Will add back in when I add relayer support
    //library = await task.deployedInstance('BatchRelayerLibrary');
    //relayer = await task.instanceAt('BalancerRelayer', await library.getEntrypoint());
  });

  before('load vault and authorizer', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));

    vault = await vaultTask.deployedInstance('Vault');
  });

  describe('composable stable pool V2+', () => {
    const LARGE_TOKEN_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';

    let owner: SignerWithAddress, whale: SignerWithAddress;
    let pool: Contract, factory: Contract;
    let usdc: Contract, dai: Contract;
    let poolId: string;
    let stableTask: Task;
    let bptIndex: number;

    before('get signers', async () => {
      owner = await getSigner();
      whale = await impersonate(LARGE_TOKEN_HOLDER);
    });

    before('load tokens and approve', async () => {
      dai = await task.instanceAt('IERC20', DAI);
      usdc = await task.instanceAt('IERC20', USDC);

      await dai.connect(whale).approve(vault.address, MAX_UINT256);
      await usdc.connect(whale).approve(vault.address, MAX_UINT256);
    });

    // Use V3 so that it's not disabled: same as V2 for joins/exits
    before('run composable stable pool V2+ task', async () => {
      stableTask = new Task('20230206-composable-stable-pool-v3', TaskMode.READ_ONLY, getForkedNetwork(hre));
      factory = await stableTask.deployedInstance('ComposableStablePoolFactory');
    });

    async function createPool(): Promise<Contract> {
      const tx = await factory.create(
        'SP',
        'SPT',
        tokens,
        amplificationParameter,
        rateProviders,
        cacheDurations,
        exemptFlags,
        swapFeePercentage,
        owner.address
      );
      const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

      pool = await stableTask.instanceAt('ComposableStablePool', event.args.pool);
      expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);
      expect(registeredAddress).to.equal(pool.address);

      bptIndex = await pool.getBptIndex();

      const composableInitialBalances = Array.from({ length: tokens.length + 1 }).map((_, i) =>
        i == bptIndex ? 0 : i < bptIndex ? initialBalances[i] : initialBalances[i - 1]
      );
      const { tokens: allTokens } = await vault.getPoolTokens(poolId);

      const userData = StablePoolEncoder.joinInit(composableInitialBalances);
      await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
        assets: allTokens,
        maxAmountsIn: Array(tokens.length + 1).fill(MAX_UINT256),
        fromInternalBalance: false,
        userData,
      });

      return pool;
    }

    function getRegisteredBalances(bptIndex: number, balances: BigNumber[]): BigNumber[] {
      return Array.from({ length: balances.length + 1 }).map((_, i) =>
        i == bptIndex ? bn(0) : i < bptIndex ? balances[i] : balances[i - 1]
      );
    }

    describe('proportional join', () => {
      before('deploy pool', async () => {
        pool = await createPool();

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
          initialBalanceDAI.div(fp(4.99)).mul(fp(1)),
          initialBalanceUSDC.div(bn(4.99e6)).mul(1e6),
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

    describe('proportional exit', () => {
      before('deploy pool', async () => {
        pool = await createPool();

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
});
