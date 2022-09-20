import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';

import { describeForkTest } from '../../../../src/forkTests';
import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { impersonate } from '../../../../src/signers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';

import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { defaultAbiCoder } from '@ethersproject/abi/lib/abi-coder';

describeForkTest('BatchRelayerLibrary', 'mainnet', 15150000, function () {
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
    task = new Task('20220720-batch-relayer-v3', TaskMode.TEST, getForkedNetwork(hre));
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
    sender = await impersonate(STAKED_ETH_STETH_HOLDER, fp(100));
  });

  before('approve relayer at the authorizer', async () => {
    const relayerActionIds = await Promise.all(
      ['swap', 'batchSwap', 'joinPool', 'exitPool', 'setRelayerApproval', 'manageUserBalance'].map((action) =>
        vault.getActionId(vault.interface.getSighash(action))
      )
    );

    // We impersonate an account with the default admin role in order to be able to approve the relayer. This assumes
    // such an account exists.
    const admin = await impersonate(await authorizer.getRoleMember(await authorizer.DEFAULT_ADMIN_ROLE(), 0), fp(100));

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
});
