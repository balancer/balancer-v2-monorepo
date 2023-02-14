import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';

describeForkTest('YearnWrapping', 'optimism', 38556442, function () {
  let task: Task;
  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  const USDC = '0x7f5c764cbc14f9669b88837ca1490cca17c31607';
  const USDC_HOLDER = '0xf390830df829cf22c53c8840554b98eafc5dcbc2';
  const yvUSDC = '0x4c8b1958b09b3bde714f68864bcc3a74eaf1a23d';

  let usdcToken: Contract, wrappedToken: Contract, yearnVault: Contract;
  let sender: SignerWithAddress;
  let chainedReference: BigNumber;
  const amountToWrap = 100e6;

  before('run task', async () => {
    task = new Task('20230213-batch-relayer-v5', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    library = await task.deployedInstance('BatchRelayerLibrary');
    relayer = await task.instanceAt('BalancerRelayer', await library.getEntrypoint());
  });

  before('load vault and tokens', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));

    vault = await vaultTask.instanceAt('Vault', await library.getVault());
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
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

  before(async () => {
    usdcToken = await task.instanceAt('IERC20', USDC);
    wrappedToken = await task.instanceAt('IERC20', yvUSDC);
    yearnVault = await task.instanceAt('IYearnTokenVault', yvUSDC);
    sender = await impersonate(USDC_HOLDER);

    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
  });

  it('should wrap successfully', async () => {
    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfYearnBefore = await wrappedToken.balanceOf(relayer.address);
    const expectedBalanceOfYearnAfter = Math.floor(1e6 / (await yearnVault.pricePerShare()) * amountToWrap);
    expect(balanceOfYearnBefore).to.be.equal(0);

    // Approving vault to pull tokens from user.
    await usdcToken.connect(sender).approve(vault.address, amountToWrap);

    chainedReference = toChainedReference(30);
    const depositIntoYearn = library.interface.encodeFunctionData('wrapYearn', [
      yvUSDC,
      sender.address,
      relayer.address,
      amountToWrap,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([depositIntoYearn]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfYearnAfter = await wrappedToken.balanceOf(relayer.address);

    expect(balanceOfUSDCBefore - balanceOfUSDCAfter).to.be.equal(amountToWrap);
    expect(balanceOfYearnAfter).to.be.almostEqual(expectedBalanceOfYearnAfter, 0.0001);
  });


  it('should unwrap successfully', async () => {
    const yearnBalance = await wrappedToken.balanceOf(relayer.address);
    const yearnAmountToWithdraw = Math.floor(yearnBalance * (await yearnVault.pricePerShare()) / 1e6);

    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfYearnBefore = await wrappedToken.balanceOf(relayer.address);

    expect(balanceOfYearnBefore).to.be.almostEqual(yearnAmountToWithdraw, 0.01);

    const withdrawFromYearn = library.interface.encodeFunctionData('unwrapYearn', [
      yvUSDC,
      relayer.address,
      sender.address,
      yearnBalance,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([withdrawFromYearn]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfYearnAfter = await wrappedToken.balanceOf(relayer.address);

    expect(balanceOfYearnAfter).to.be.equal(0);
    expect(balanceOfUSDCAfter - balanceOfUSDCBefore).to.be.almostEqual(amountToWrap, 0.000001);
  });
});

function toChainedReference(key: BigNumberish): BigNumber {
  const CHAINED_REFERENCE_PREFIX = 'ba10';
  // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
  const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

  return BigNumber.from(paddedPrefix).add(key);
}