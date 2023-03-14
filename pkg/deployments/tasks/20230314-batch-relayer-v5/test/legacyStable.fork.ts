import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StablePoolEncoder } from '@balancer-labs/balancer-js';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { defaultAbiCoder } from '@ethersproject/abi/lib/abi-coder';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { describeForkTest, getSigner, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';
import {
  DAI,
  USDC,
  amplificationParameter,
  cacheDurations,
  rateProviders,
  swapFeePercentage,
  tokens,
  initialBalances,
  PoolKind,
} from './helpers/sharedStableParams';

describeForkTest('BatchRelayerLibrary - Legacy Stable', 'mainnet', 14860000, function () {
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

  describe('original stable pools', () => {
    const LARGE_TOKEN_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';

    enum LegacyStablePoolExitKind {
      EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0,
      EXACT_BPT_IN_FOR_TOKENS_OUT,
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

    context('stable pool', () => {
      before('run original stable task', async () => {
        stableTask = new Task('20210624-stable-pool', TaskMode.READ_ONLY, getForkedNetwork(hre));
        factory = await stableTask.deployedInstance('StablePoolFactory');
      });

      before('deploy stable pool', async () => {
        const tx = await factory.create('SP', 'SPT', tokens, amplificationParameter, swapFeePercentage, owner.address);
        const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

        pool = await stableTask.instanceAt('StablePool', event.args.pool);
        expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

        poolId = await pool.getPoolId();
        const [registeredAddress] = await vault.getPool(poolId);
        expect(registeredAddress).to.equal(pool.address);
      });

      before('initialize stable pool', async () => {
        const userData = StablePoolEncoder.joinInit(initialBalances);

        await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
          assets: tokens,
          maxAmountsIn: initialBalances,
          fromInternalBalance: false,
          userData,
        });
      });

      it('can exit proportionally through the relayer', async () => {
        const bptBalance = await pool.balanceOf(owner.address);
        expect(bptBalance).to.gt(0);

        const vaultDAIBalanceBeforeExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceBeforeExit = await dai.balanceOf(owner.address);

        const userData = defaultAbiCoder.encode(
          ['uint256', 'uint256'],
          [LegacyStablePoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptBalance]
        );

        // Send BPT to the relayer so it can exit.
        await pool.connect(owner).transfer(relayer.address, bptBalance);

        const exitCalldata = library.interface.encodeFunctionData('exitPool', [
          poolId,
          PoolKind.LEGACY_STABLE,
          relayer.address,
          owner.address,
          {
            assets: tokens,
            minAmountsOut: tokens.map(() => 0),
            toInternalBalance: false,
            userData,
          },
          [],
        ]);

        await relayer.connect(owner).multicall([exitCalldata]);

        const remainingBalance = await pool.balanceOf(owner.address);
        expect(remainingBalance).to.equal(0);

        const vaultDAIBalanceAfterExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceAfterExit = await dai.balanceOf(owner.address);

        expect(vaultDAIBalanceAfterExit).to.lt(vaultDAIBalanceBeforeExit);
        expect(ownerDAIBalanceAfterExit).to.gt(ownerDAIBalanceBeforeExit);
      });
    });

    context('metastable pool', () => {
      before('run stable pool task', async () => {
        stableTask = new Task('20210727-meta-stable-pool', TaskMode.READ_ONLY, getForkedNetwork(hre));
        factory = await stableTask.deployedInstance('MetaStablePoolFactory');
      });

      before('deploy meta stable pool', async () => {
        const tx = await factory.create(
          'MSP',
          'MSPT',
          tokens,
          amplificationParameter,
          rateProviders,
          cacheDurations,
          swapFeePercentage,
          false, // oracle enabled
          owner.address
        );

        const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

        pool = await stableTask.instanceAt('MetaStablePool', event.args.pool);
        expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

        poolId = await pool.getPoolId();
        const [registeredAddress] = await vault.getPool(poolId);
        expect(registeredAddress).to.equal(pool.address);
      });

      before('initialize meta stable pool', async () => {
        const userData = StablePoolEncoder.joinInit(initialBalances);
        await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
          assets: tokens,
          maxAmountsIn: initialBalances,
          fromInternalBalance: false,
          userData,
        });
      });

      it('can exit proportionally through the relayer', async () => {
        const bptBalance = await pool.balanceOf(owner.address);
        expect(bptBalance).to.gt(0);

        const vaultDAIBalanceBeforeExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceBeforeExit = await dai.balanceOf(owner.address);

        const userData = defaultAbiCoder.encode(
          ['uint256', 'uint256'],
          [LegacyStablePoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptBalance]
        );

        // Send BPT to the relayer so it can exit.
        await pool.connect(owner).transfer(relayer.address, bptBalance);

        const exitCalldata = library.interface.encodeFunctionData('exitPool', [
          poolId,
          PoolKind.LEGACY_STABLE,
          relayer.address,
          owner.address,
          {
            assets: tokens,
            minAmountsOut: tokens.map(() => 0),
            toInternalBalance: false,
            userData,
          },
          [],
        ]);

        await relayer.connect(owner).multicall([exitCalldata]);

        const remainingBalance = await pool.balanceOf(owner.address);
        expect(remainingBalance).to.equal(0);

        const vaultDAIBalanceAfterExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceAfterExit = await dai.balanceOf(owner.address);

        expect(vaultDAIBalanceAfterExit).to.lt(vaultDAIBalanceBeforeExit);
        expect(ownerDAIBalanceAfterExit).to.gt(ownerDAIBalanceBeforeExit);
      });
    });
  });
});
