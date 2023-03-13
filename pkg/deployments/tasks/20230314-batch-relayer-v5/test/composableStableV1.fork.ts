import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StablePoolEncoder } from '@balancer-labs/balancer-js';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { defaultAbiCoder } from '@ethersproject/abi/lib/abi-coder';
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
  PoolKind,
} from './helpers/sharedStableParams';

describeForkTest('BatchRelayerLibrary - Composable Stable V1', 'mainnet', 16083775, function () {
  let task: Task;

  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  before('run task', async () => {
    task = new Task('20230314-batch-relayer-v5', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });

    library = await task.deployedInstance('BatchRelayerLibrary');
    relayer = await task.instanceAt('BalancerRelayer', await library.getEntrypoint());
  });

  before('load vault and authorizer', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));

    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
  });

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

  before('approve relayer at the authorizer', async () => {
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        vault.getActionId(vault.interface.getSighash(action))
      )
    );

    // We impersonate an account with the default admin role in order to be able to approve the relayer. This assumes
    // such an account exists.
    const admin = await impersonate(await authorizer.getRoleMember(await authorizer.DEFAULT_ADMIN_ROLE(), 0));

    // Grant relayer permission to call all relayer functions
    await authorizer.connect(admin).grantRoles(relayerActionIds, relayer.address);
  });

  before('approve relayer by the user', async () => {
    await vault.connect(owner).setRelayerApproval(owner.address, relayer.address, true);
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
  it('can exit with exact tokens through the relayer', async () => {
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

    const exitCalldata = library.interface.encodeFunctionData('exitPool', [
      poolId,
      PoolKind.COMPOSABLE_STABLE,
      owner.address,
      owner.address,
      {
        assets: allTokens,
        minAmountsOut: Array(tokens.length + 1).fill(0),
        toInternalBalance: false,
        userData,
      },
      [],
    ]);

    await relayer.connect(owner).multicall([exitCalldata]);

    const vaultDAIBalanceAfterExit = await dai.balanceOf(vault.address);
    const ownerDAIBalanceAfterExit = await dai.balanceOf(owner.address);

    expect(vaultDAIBalanceAfterExit).to.lt(vaultDAIBalanceBeforeExit);
    expect(ownerDAIBalanceAfterExit).to.gt(ownerDAIBalanceBeforeExit);
  });
});
