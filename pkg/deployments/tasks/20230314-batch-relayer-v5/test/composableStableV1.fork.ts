import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StablePoolEncoder } from '@balancer-labs/balancer-js';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { defaultAbiCoder } from '@ethersproject/abi/lib/abi-coder';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { describeForkTest, getSigner, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';

describeForkTest('BatchRelayerLibrary - Composable Stable V1', 'mainnet', 16083775, function () {
  let task: Task;

  //let relayer: Contract, library: Contract;
  let vault: Contract;

  before('run task', async () => {
    task = new Task('20230314-batch-relayer-v5', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    // Put back when going through relayer
    //library = await task.deployedInstance('BatchRelayerLibrary');
    //relayer = await task.instanceAt('BalancerRelayer', await library.getEntrypoint());
  });

  before('load vault and authorizer', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));

    vault = await vaultTask.deployedInstance('Vault');
  });

  describe('composable stable pool V1', () => {
    const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

    const tokens = [DAI, USDC];
    const amplificationParameter = bn(100);
    const swapFeePercentage = fp(0.01);
    const initialBalanceDAI = fp(1e6);
    const initialBalanceUSDC = fp(1e6).div(1e12); // 6 digits
    const initialBalances = [initialBalanceDAI, initialBalanceUSDC];
    const rateProviders = [ZERO_ADDRESS, ZERO_ADDRESS];
    const cacheDurations = [FP_ZERO, FP_ZERO];
    const exemptFlags = [false, false];

    const LARGE_TOKEN_HOLDER = '0xf977814e90da44bfa03b6295a0616a897441acec';

    enum ComposableStablePoolV1ExitKind {
      EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0,
      BPT_IN_FOR_EXACT_TOKENS_OUT,
    }

    let owner: SignerWithAddress, whale: SignerWithAddress;
    let pool: Contract, factory: Contract;
    let usdc: Contract, dai: Contract;
    let poolId: string;
    let stableTask: Task;

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

    before('run composable stable pool task', async () => {
      stableTask = new Task('20220906-composable-stable-pool', TaskMode.READ_ONLY, getForkedNetwork(hre));
      factory = await stableTask.deployedInstance('ComposableStablePoolFactory');
    });

    before('deploy composable stable pool', async () => {
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
    });

    before('initialize composable stable pool', async () => {
      const bptIndex = await pool.getBptIndex();

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
    });

    // V1 does not support proportional exits
    it('can exit with exact tokens', async () => {
      const bptBalance = await pool.balanceOf(owner.address);
      expect(bptBalance).to.gt(0);

      const vaultDAIBalanceBeforeExit = await dai.balanceOf(vault.address);
      const ownerDAIBalanceBeforeExit = await dai.balanceOf(owner.address);
      const { tokens: allTokens } = await vault.getPoolTokens(poolId);
      const amountsOut = [fp(100), bn(100e6)];

      const userData = defaultAbiCoder.encode(
        ['uint256', 'uint256[]', 'uint256'],
        [ComposableStablePoolV1ExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT, amountsOut, MAX_UINT256]
      );
      await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
        assets: allTokens,
        minAmountsOut: Array(tokens.length + 1).fill(0),
        fromInternalBalance: false,
        userData,
      });

      const vaultDAIBalanceAfterExit = await dai.balanceOf(vault.address);
      const ownerDAIBalanceAfterExit = await dai.balanceOf(owner.address);

      expect(vaultDAIBalanceAfterExit).to.lt(vaultDAIBalanceBeforeExit);
      expect(ownerDAIBalanceAfterExit).to.gt(ownerDAIBalanceBeforeExit);
    });
  });
});
