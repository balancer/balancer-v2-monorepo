import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode, getSigner } from '../../../src';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

describeForkTest('GearboxWrapping', 'mainnet', 16622559, function () {
  let task: Task;
  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199';
  const dUSDC = '0xc411db5f5eb3f7d552f9b8454b2d74097ccde6e3';

  let usdcToken: Contract, dieselToken: Contract, gearboxVault: Contract;
  let sender: SignerWithAddress, recipient: SignerWithAddress;
  let chainedReference: BigNumber;
  const amountToWrap = 100e6;

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
    dieselToken = await task.instanceAt('IGearboxDieselToken', dUSDC);
    gearboxVault = await task.instanceAt('IGearboxVault', await dieselToken.owner());
    sender = await impersonate(USDC_HOLDER);
    recipient = await getSigner();

    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
    await vault.connect(recipient).setRelayerApproval(recipient.address, relayer.address, true);
  });

  it('should wrap successfully', async () => {
    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    const balanceOfDieselBefore = await dieselToken.balanceOf(recipient.address);

    expect(balanceOfDieselBefore).to.be.equal(0);

    // Approving vault to pull tokens from user.
    await usdcToken.connect(sender).approve(vault.address, amountToWrap);

    chainedReference = toChainedReference(30);
    const depositIntoGearbox = library.interface.encodeFunctionData('wrapGearbox', [
      dUSDC,
      sender.address,
      recipient.address,
      amountToWrap,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([depositIntoGearbox]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    const balanceOfDieselAfter = await dieselToken.balanceOf(recipient.address);
    const expectedBalanceOfDieselAfter = await gearboxVault.toDiesel(amountToWrap);

    expect(balanceOfUSDCBefore.sub(balanceOfUSDCAfter)).to.be.equal(amountToWrap);
    expect(balanceOfDieselAfter).to.be.equal(expectedBalanceOfDieselAfter);
  });

  it('should unwrap successfully', async () => {
    const dieselAmountToWithdraw = await gearboxVault.toDiesel(amountToWrap);

    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    const balanceOfDieselBefore = await dieselToken.balanceOf(recipient.address);

    expect(balanceOfDieselBefore).to.be.equal(dieselAmountToWithdraw);

    const withdrawFromGearbox = library.interface.encodeFunctionData('unwrapGearbox', [
      dUSDC,
      recipient.address,
      sender.address,
      chainedReference,
      0,
    ]);

    await dieselToken.connect(recipient).approve(vault.address, MAX_UINT256);

    await relayer.connect(recipient).multicall([withdrawFromGearbox]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    const balanceOfDieselAfter = await dieselToken.balanceOf(recipient.address);

    expect(balanceOfDieselAfter).to.be.equal(0);
    expect(balanceOfUSDCAfter.sub(balanceOfUSDCBefore)).to.be.almostEqual(amountToWrap, 0.01);
  });
});

function toChainedReference(key: BigNumberish): BigNumber {
  const CHAINED_REFERENCE_PREFIX = 'ba10';
  // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
  const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

  return BigNumber.from(paddedPrefix).add(key);
}
