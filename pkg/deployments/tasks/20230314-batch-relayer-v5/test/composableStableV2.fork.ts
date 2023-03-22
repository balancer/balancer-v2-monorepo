import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StablePoolEncoder } from '@balancer-labs/balancer-js';
import { fp } from '@balancer-labs/v2-helpers/src/numbers';
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
  PoolKind,
} from './helpers/sharedStableParams';

describeForkTest('BatchRelayerLibrary - Composable Stable V2+', 'mainnet', 16789433, function () {
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
    await vault.connect(whale).setRelayerApproval(whale.address, relayer.address, true);
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

  describe('proportional join/exit through relayer', () => {
    before('deploy pool', async () => {
      pool = await createPool();

      poolId = await pool.getPoolId();
      const [registeredAddress] = await vault.getPool(poolId);
      expect(registeredAddress).to.equal(pool.address);
    });

    it('can join and exit', async () => {
      const bptAmount = fp(1000);

      const whaleDAIBalanceBeforeJoinExit = await dai.balanceOf(whale.address);
      const ownerDAIBalanceBeforeJoinExit = await dai.balanceOf(owner.address);

      const { tokens: allTokens } = await vault.getPoolTokens(poolId);

      const joinUserData = StablePoolEncoder.joinAllTokensInForExactBptOut(bptAmount);

      const joinCalldata = library.interface.encodeFunctionData('joinPool', [
        poolId,
        PoolKind.COMPOSABLE_STABLE_V2,
        whale.address,
        whale.address,
        {
          assets: allTokens,
          maxAmountsIn: Array(tokens.length + 1).fill(MAX_UINT256),
          userData: joinUserData,
          fromInternalBalance: false,
        },
        0,
        0,
      ]);

      const exitUserData = StablePoolEncoder.exitExactBptInForTokensOut(bptAmount);

      const exitCalldata = library.interface.encodeFunctionData('exitPool', [
        poolId,
        PoolKind.COMPOSABLE_STABLE_V2,
        whale.address,
        owner.address,
        {
          assets: allTokens,
          minAmountsOut: Array(tokens.length + 1).fill(0),
          userData: exitUserData,
          toInternalBalance: false,
        },
        [],
      ]);

      await relayer.connect(whale).multicall([joinCalldata, exitCalldata]);

      const whaleDAIBalanceAfterJoinExit = await dai.balanceOf(whale.address);
      const ownerDAIBalanceAfterJoinExit = await dai.balanceOf(owner.address);

      expect(whaleDAIBalanceAfterJoinExit).to.lt(whaleDAIBalanceBeforeJoinExit);
      expect(ownerDAIBalanceAfterJoinExit).to.gt(ownerDAIBalanceBeforeJoinExit);
    });
  });
});
