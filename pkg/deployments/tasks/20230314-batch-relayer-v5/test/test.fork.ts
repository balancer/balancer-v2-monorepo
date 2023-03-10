import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { BigNumberish, FP_ZERO } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { WeightedPoolEncoder, StablePoolEncoder } from '@balancer-labs/balancer-js';
import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { defaultAbiCoder } from '@ethersproject/abi/lib/abi-coder';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { describeForkTest, getSigner, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';

describeForkTest('BatchRelayerLibrary', 'mainnet', 16794319, function () {
  let task: Task;

  let relayer: Contract, library: Contract;
  let sender: SignerWithAddress;
  let vault: Contract, authorizer: Contract;

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  const ETH_STETH_POOL = '0x32296969ef14eb0c6d29669c550d4a0449130230000200000000000000000080';
  const ETH_STETH_GAUGE = '0xcD4722B7c24C29e0413BDCd9e51404B4539D14aE';

  const ETH_DAI_POOL = '0x0b09dea16768f0799065c475be02919503cb2a3500020000000000000000001a';
  const ETH_DAI_GAUGE = '0x4ca6AC0509E6381Ca7CD872a6cdC0Fbf00600Fa1';

  const STAKED_ETH_STETH_HOLDER = '0x4B581dedA2f2C0650C3dFC506C86a8C140d9f699';

  const CHAINED_REFERENCE_PREFIX = 'ba10';
  function toChainedReference(key: BigNumberish): BigNumber {
    // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
    const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

    return BigNumber.from(paddedPrefix).add(key);
  }

  before('run task', async () => {
    task = new Task('20230314-batch-relayer-v5', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    library = await task.deployedInstance('BatchRelayerLibrary');
    relayer = await task.instanceAt('BalancerRelayer', await library.getEntrypoint());
  });

  before('load vault and tokens', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));

    vault = await vaultTask.instanceAt('Vault', await library.getVault());
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
  });

  before('load signers', async () => {
    // We impersonate an account that holds staked BPT for the ETH_STETH Pool.
    sender = await impersonate(STAKED_ETH_STETH_HOLDER);
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
    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
  });

  it('sender can unstake, exit, join and stake', async () => {
    const destinationGauge = await task.instanceAt('IERC20', ETH_DAI_GAUGE);
    expect(await destinationGauge.balanceOf(sender.address)).to.be.equal(0);

    // We use the relayer as the intermediate token holder as that saves gas (since there's fewer transfers, relayer
    // permission checks, etc.) and also sidesteps the issue that not all BPT has Vault allowance (which is required to
    // transfer them via the Vault, e.g. for staking).

    const stakedBalance = await (await task.instanceAt('IERC20', ETH_STETH_GAUGE)).balanceOf(sender.address);

    // There's no chained output here as the input equals the output
    const unstakeCalldata = library.interface.encodeFunctionData('gaugeWithdraw', [
      ETH_STETH_GAUGE,
      sender.address,
      relayer.address,
      stakedBalance,
    ]);

    // Exit into WETH (it'd be more expensive to use ETH, and we'd have to use the relayer as an intermediary as we'd
    // need to use said ETH).

    const ethStethTokens: Array<string> = (await vault.getPoolTokens(ETH_STETH_POOL)).tokens;
    const stableWethIndex = ethStethTokens.findIndex((token) => token.toLowerCase() == WETH.toLowerCase());

    const exitCalldata = library.interface.encodeFunctionData('exitPool', [
      ETH_STETH_POOL,
      0, // Even if this a Stable Pool, the Batch Relayer is unaware of their encodings and the Weighted Pool encoding
      // happens to match here
      relayer.address,
      relayer.address,
      {
        assets: ethStethTokens,
        minAmountsOut: ethStethTokens.map(() => 0),
        // Note that we use the same input as before
        userData: defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [0, stakedBalance, stableWethIndex]),
        toInternalBalance: true,
      },
      // Only store a chained reference for the WETH amount out, as the rest will be zero
      [{ key: toChainedReference(42), index: stableWethIndex }],
    ]);

    // Join from WETH
    const ethDaiTokens: Array<string> = (await vault.getPoolTokens(ETH_DAI_POOL)).tokens;
    const ethDaiAmountsIn = ethDaiTokens.map((token) =>
      token.toLowerCase() == WETH.toLowerCase() ? toChainedReference(42) : 0
    );

    const joinCalldata = library.interface.encodeFunctionData('joinPool', [
      ETH_DAI_POOL,
      0, // Weighted Pool
      relayer.address,
      relayer.address,
      {
        assets: ethDaiTokens,
        maxAmountsIn: ethDaiTokens.map(() => MAX_UINT256),
        userData: WeightedPoolEncoder.joinExactTokensInForBPTOut(ethDaiAmountsIn, 0),
        fromInternalBalance: true, // Since we're joining from internal balance, we don't need to grant token allowance
      },
      0, // No eth
      toChainedReference(17), // Store a reference for later staking
    ]);

    const stakeCalldata = library.interface.encodeFunctionData('gaugeDeposit', [
      ETH_DAI_GAUGE,
      relayer.address,
      sender.address,
      toChainedReference(17), // Stake all BPT from the join
    ]);

    await relayer.connect(sender).multicall([unstakeCalldata, exitCalldata, joinCalldata, stakeCalldata]);

    expect(await destinationGauge.balanceOf(sender.address)).to.be.gt(0);
  });

  describe('stable pools', () => {
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

    const LARGE_TOKEN_HOLDER = '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503';

    enum LegacyStablePoolExitKind {
      EXACT_BPT_IN_FOR_ONE_TOKEN_OUT = 0,
      EXACT_BPT_IN_FOR_TOKENS_OUT,
      BPT_IN_FOR_EXACT_TOKENS_OUT,
    }

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

    context('original stable pool', () => {
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

      it('can exit proportionally', async () => {
        const bptBalance = await pool.balanceOf(owner.address);
        expect(bptBalance).to.gt(0);

        const vaultDAIBalanceBeforeExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceBeforeExit = await dai.balanceOf(owner.address);

        const userData = defaultAbiCoder.encode(
          ['uint256', 'uint256'],
          [LegacyStablePoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptBalance]
        );
        await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
          assets: tokens,
          minAmountsOut: Array(tokens.length).fill(0),
          fromInternalBalance: false,
          userData,
        });

        const remainingBalance = await pool.balanceOf(owner.address);
        expect(remainingBalance).to.equal(0);

        const vaultDAIBalanceAfterExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceAfterExit = await dai.balanceOf(owner.address);

        expect(vaultDAIBalanceAfterExit).to.lt(vaultDAIBalanceBeforeExit);
        expect(ownerDAIBalanceAfterExit).to.gt(ownerDAIBalanceBeforeExit);
      });
    });

    context('stable pool V2', () => {
      before('run stable pool task', async () => {
        stableTask = new Task('20220609-stable-pool-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
        factory = await stableTask.deployedInstance('StablePoolFactory');
      });

      before('deploy stable pool V2', async () => {
        const tx = await factory.create('SP', 'SPT', tokens, amplificationParameter, swapFeePercentage, owner.address);
        const event = expectEvent.inReceipt(await tx.wait(), 'PoolCreated');

        pool = await stableTask.instanceAt('StablePool', event.args.pool);
        expect(await factory.isPoolFromFactory(pool.address)).to.be.true;

        poolId = await pool.getPoolId();
        const [registeredAddress] = await vault.getPool(poolId);
        expect(registeredAddress).to.equal(pool.address);
      });

      before('initialize stable pool V2', async () => {
        const userData = StablePoolEncoder.joinInit(initialBalances);
        await vault.connect(whale).joinPool(poolId, whale.address, owner.address, {
          assets: tokens,
          maxAmountsIn: initialBalances,
          fromInternalBalance: false,
          userData,
        });
      });

      it('can exit proportionally', async () => {
        const bptBalance = await pool.balanceOf(owner.address);
        expect(bptBalance).to.gt(0);

        const vaultDAIBalanceBeforeExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceBeforeExit = await dai.balanceOf(owner.address);

        const userData = defaultAbiCoder.encode(
          ['uint256', 'uint256'],
          [LegacyStablePoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptBalance]
        );
        await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
          assets: tokens,
          minAmountsOut: Array(tokens.length).fill(0),
          fromInternalBalance: false,
          userData,
        });

        const remainingBalance = await pool.balanceOf(owner.address);
        expect(remainingBalance).to.equal(0);

        const vaultDAIBalanceAfterExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceAfterExit = await dai.balanceOf(owner.address);

        expect(vaultDAIBalanceAfterExit).to.lt(vaultDAIBalanceBeforeExit);
        expect(ownerDAIBalanceAfterExit).to.gt(ownerDAIBalanceBeforeExit);
      });
    });

    context('meta stable pool', () => {
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

      it('can exit proportionally', async () => {
        const bptBalance = await pool.balanceOf(owner.address);
        expect(bptBalance).to.gt(0);

        const vaultDAIBalanceBeforeExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceBeforeExit = await dai.balanceOf(owner.address);

        const userData = defaultAbiCoder.encode(
          ['uint256', 'uint256'],
          [LegacyStablePoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT, bptBalance]
        );
        await vault.connect(owner).exitPool(poolId, owner.address, owner.address, {
          assets: tokens,
          minAmountsOut: Array(tokens.length).fill(0),
          fromInternalBalance: false,
          userData,
        });

        const remainingBalance = await pool.balanceOf(owner.address);
        expect(remainingBalance).to.equal(0);

        const vaultDAIBalanceAfterExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceAfterExit = await dai.balanceOf(owner.address);

        expect(vaultDAIBalanceAfterExit).to.lt(vaultDAIBalanceBeforeExit);
        expect(ownerDAIBalanceAfterExit).to.gt(ownerDAIBalanceBeforeExit);
      });
    });

    // Stable Phantom is hard to test because it can only be exited when paused: and the pause window expired

    // The Composable Stable Pool V1 factory is disabled

    context('composable stable pool V1', () => {
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

        const remainingBalance = await pool.balanceOf(owner.address);
        expect(remainingBalance).to.equal(0);

        const vaultDAIBalanceAfterExit = await dai.balanceOf(vault.address);
        const ownerDAIBalanceAfterExit = await dai.balanceOf(owner.address);

        expect(vaultDAIBalanceAfterExit).to.lt(vaultDAIBalanceBeforeExit);
        expect(ownerDAIBalanceAfterExit).to.gt(ownerDAIBalanceBeforeExit);
      });
    });

    // Use V3 so that it's not disabled: same as V2 for joins/exits
    context('composable stable pool V2+', () => {
      let bptIndex: number;

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
});
