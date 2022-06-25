import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { impersonate } from '../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { StablePoolEncoder, WeightedPoolEncoder } from '@balancer-labs/balancer-js';

describe('DoubleEntrypointFixRelayer', function () {
  let govMultisig: SignerWithAddress;
  let btcBptHolder: SignerWithAddress, snxBptHolder: SignerWithAddress;
  let relayer: Contract;

  let vault: Contract, balancerHelpers: Contract, authorizer: Contract, protocolFeesCollector: Contract;
  let wBTCContract: Contract, renBTCContract: Contract, sBTCContract: Contract;
  let wethContract: Contract, snxContract: Contract;

  const task = new Task('20220513-double-entrypoint-fix-relayer', TaskMode.TEST, getForkedNetwork(hre));

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const BTC_STABLE_POOL_GAUGE = '0x57d40FF4cF7441A04A05628911F57bb940B6C238';
  const SNX_WEIGHTED_POOL_GAUGE = '0x605eA53472A496c3d483869Fe8F355c12E861e19';

  const BTC_STABLE_POOL_ID = '0xfeadd389a5c427952d8fdb8057d6c8ba1156cc56000000000000000000000066';
  const BTC_STABLE_POOL_ADDRESS = '0xFeadd389a5c427952D8fdb8057D6C8ba1156cC56';
  const wBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
  const renBTC = '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d';
  const sBTC = '0xfe18be6b3bd88a2d2a7f928d00292e7a9963cfc6';
  const sBTC_IMPLEMENTATION = '0x18FcC34bdEaaF9E3b69D2500343527c0c995b1d6';

  const SNX_WEIGHTED_POOL_ID = '0x072f14b85add63488ddad88f855fda4a99d6ac9b000200000000000000000027';
  const SNX_WEIGHTED_POOL_ADDRESS = '0x072f14B85ADd63488DDaD88f855Fda4A99d6aC9B';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const SNX = '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F';
  const SNX_IMPLEMENTATION = '0x639032d3900875a4cf4960aD6b9ee441657aA93C';

  before('run task', async () => {
    await task.run({ force: true });
    relayer = await task.deployedInstance('DoubleEntrypointFixRelayer');
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    balancerHelpers = await vaultTask.deployedInstance('BalancerHelpers');
    protocolFeesCollector = await vaultTask.instanceAt('ProtocolFeesCollector', await vault.getProtocolFeesCollector());

    // We reuse this task as it contains an ABI for an ERC20 token
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    wBTCContract = await testBALTokenTask.instanceAt('TestBalancerToken', wBTC);
    renBTCContract = await testBALTokenTask.instanceAt('TestBalancerToken', renBTC);
    sBTCContract = await testBALTokenTask.instanceAt('TestBalancerToken', sBTC);
    wethContract = await testBALTokenTask.instanceAt('TestBalancerToken', WETH);
    snxContract = await testBALTokenTask.instanceAt('TestBalancerToken', SNX);
  });

  before('grant permissions', async () => {
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    // Gov approval for relayer
    const exitPoolRole = await actionId(vault, 'exitPool');
    const withdrawCollectedFeesRole = await actionId(protocolFeesCollector, 'withdrawCollectedFees');
    await authorizer.connect(govMultisig).grantRoles([exitPoolRole, withdrawCollectedFeesRole], relayer.address);

    // User approval for relayer
    btcBptHolder = await impersonate(BTC_STABLE_POOL_GAUGE, fp(100));
    await vault.connect(btcBptHolder).setRelayerApproval(btcBptHolder.address, relayer.address, true);

    snxBptHolder = await impersonate(SNX_WEIGHTED_POOL_GAUGE, fp(100));
    await vault.connect(snxBptHolder).setRelayerApproval(snxBptHolder.address, relayer.address, true);
  });

  it('sweeps sBTC', async () => {
    const vaultBalanceBefore = await sBTCContract.balanceOf(vault.address);
    const protocolFeesCollectorBalanceBefore = await sBTCContract.balanceOf(protocolFeesCollector.address);

    await relayer.sweepDoubleEntrypointToken([sBTC_IMPLEMENTATION, sBTC]);

    const vaultBalanceAfter = await sBTCContract.balanceOf(vault.address);
    const protocolFeesCollectorBalanceAfter = await sBTCContract.balanceOf(protocolFeesCollector.address);

    expect(vaultBalanceAfter).to.be.eq(0);
    expect(protocolFeesCollectorBalanceAfter.sub(protocolFeesCollectorBalanceBefore)).to.be.eq(vaultBalanceBefore);
  });

  it('exits from the sBTC pool', async () => {
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const poolContract = await testBALTokenTask.instanceAt('TestBalancerToken', BTC_STABLE_POOL_ADDRESS);

    const [, expectedAmountsOut] = await balancerHelpers.callStatic.queryExit(
      BTC_STABLE_POOL_ID,
      btcBptHolder.address,
      btcBptHolder.address,
      {
        assets: [wBTC, renBTC, sBTC],
        minAmountsOut: [0, 0, 0],
        userData: StablePoolEncoder.exitExactBPTInForTokensOut(await poolContract.balanceOf(btcBptHolder.address)),
        toInternalBalance: false,
      }
    );

    await relayer.connect(btcBptHolder).exitBTCStablePool();

    const actualAmountsOut = await Promise.all(
      [wBTCContract, renBTCContract, sBTCContract].map((token) => token.balanceOf(btcBptHolder.address))
    );

    expect(await poolContract.balanceOf(btcBptHolder.address)).to.be.eq(0);
    expect(expectedAmountsOut).to.be.deep.eq(actualAmountsOut);

    const vaultBalanceAfter = await sBTCContract.balanceOf(vault.address);
    expect(vaultBalanceAfter).to.be.eq(0);
  });

  it('sweeps SNX', async () => {
    const vaultBalanceBefore = await snxContract.balanceOf(vault.address);
    const protocolFeesCollectorBalanceBefore = await snxContract.balanceOf(protocolFeesCollector.address);

    await relayer.sweepDoubleEntrypointToken([SNX_IMPLEMENTATION, SNX]);

    const vaultBalanceAfter = await snxContract.balanceOf(vault.address);
    const protocolFeesCollectorBalanceAfter = await snxContract.balanceOf(protocolFeesCollector.address);

    expect(vaultBalanceAfter).to.be.eq(0);
    expect(protocolFeesCollectorBalanceAfter.sub(protocolFeesCollectorBalanceBefore)).to.be.eq(vaultBalanceBefore);
  });

  it('exits from the SNX pool', async () => {
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const poolContract = await testBALTokenTask.instanceAt('TestBalancerToken', SNX_WEIGHTED_POOL_ADDRESS);

    const [, expectedAmountsOut] = await balancerHelpers.callStatic.queryExit(
      SNX_WEIGHTED_POOL_ID,
      snxBptHolder.address,
      snxBptHolder.address,
      {
        assets: [SNX, WETH],
        minAmountsOut: [0, 0],
        userData: WeightedPoolEncoder.exitExactBPTInForTokensOut(await poolContract.balanceOf(snxBptHolder.address)),
        toInternalBalance: false,
      }
    );

    await relayer.connect(snxBptHolder).exitSNXWeightedPool();

    const actualAmountsOut = await Promise.all(
      [snxContract, wethContract].map((token) => token.balanceOf(snxBptHolder.address))
    );

    expect(await poolContract.balanceOf(snxBptHolder.address)).to.be.eq(0);
    expect(expectedAmountsOut).to.be.deep.eq(actualAmountsOut);

    const vaultBalanceAfter = await snxContract.balanceOf(vault.address);
    expect(vaultBalanceAfter).to.be.eq(0);
  });
});
