import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';

describeForkTest('TetuWrapping', 'polygon', 37945364, function () {
  let task: Task;
  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
  const USDT_HOLDER = '0xf977814e90da44bfa03b6295a0616a897441acec';
  const xUSDT = '0xE680e0317402ad3CB37D5ed9fc642702658Ef57F';

  const TETU_GOVERNANCE = '0xcc16d636dD05b52FF1D8B9CE09B09BC62b11412B';
  const TETU_CONTROLLER = '0x6678814c273d5088114B6E40cC49C8DB04F9bC29';

  let usdtToken: Contract, wrappedToken: Contract, tetuVault: Contract;
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
    usdtToken = await task.instanceAt('IERC20', USDT);
    wrappedToken = await task.instanceAt('IERC20', xUSDT);
    tetuVault = await task.instanceAt('ITetuSmartVault', xUSDT);
    sender = await impersonate(USDT_HOLDER);

    // Set white list approvals for the batch relayer to interacte with the Tetu Smart Vault
    const governance = await impersonate(TETU_GOVERNANCE);
    const controller = await task.instanceAt('ITetuController', TETU_CONTROLLER);
    await controller.connect(governance).changeWhiteListStatus([relayer.address], true);

    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
  });

  it('should wrap successfully', async () => {
    const balanceOfUSDTBefore = await usdtToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfTetuBefore = await wrappedToken.balanceOf(relayer.address);
    const expectedBalanceOfTetuAfter = Math.floor((1e6 / (await tetuVault.getPricePerFullShare())) * amountToWrap);

    expect(balanceOfTetuBefore).to.be.equal(0);

    // Approving vault to pull tokens from user.
    await usdtToken.connect(sender).approve(vault.address, amountToWrap);

    chainedReference = toChainedReference(30);
    const depositIntoTetu = library.interface.encodeFunctionData('wrapTetu', [
      xUSDT,
      sender.address,
      relayer.address,
      amountToWrap,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([depositIntoTetu]);

    const balanceOfUSDTAfter = await usdtToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfTetuAfter = await wrappedToken.balanceOf(relayer.address);

    expect(balanceOfUSDTBefore - balanceOfUSDTAfter).to.be.equal(amountToWrap);
    expect(balanceOfTetuAfter).to.be.almostEqual(expectedBalanceOfTetuAfter, 0.000001);
  });

  it('should unwrap successfully', async () => {
    const tetuBalance = await wrappedToken.balanceOf(relayer.address);
    const tetuAmountToWithdraw = Math.floor((tetuBalance * (await tetuVault.getPricePerFullShare())) / 1e6);

    const balanceOfUSDTBefore = await usdtToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens

    const withdrawFromTetu = library.interface.encodeFunctionData('unwrapTetu', [
      xUSDT,
      relayer.address,
      sender.address,
      chainedReference,
      0,
    ]);

    await relayer.connect(sender).multicall([withdrawFromTetu]);

    const balanceOfUSDTAfter = await usdtToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfTetuAfter = await wrappedToken.balanceOf(relayer.address);

    expect(balanceOfTetuAfter).to.be.equal(0);
    expect(balanceOfUSDTAfter - balanceOfUSDTBefore).to.be.almostEqual(tetuAmountToWithdraw, 0.0001);
  });
});

function toChainedReference(key: BigNumberish): BigNumber {
  const CHAINED_REFERENCE_PREFIX = 'ba10';
  // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
  const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

  return BigNumber.from(paddedPrefix).add(key);
}
