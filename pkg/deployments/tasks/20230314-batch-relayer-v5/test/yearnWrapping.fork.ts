import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode, getSigner } from '../../../src';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

describeForkTest('YearnWrapping', 'mainnet', 16622559, function () {
  let task: Task;
  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199';
  const yvUSDC = '0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE';

  let usdcToken: Contract, yearnToken: Contract;
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
    yearnToken = await task.instanceAt('IYearnTokenVault', yvUSDC);
    sender = await impersonate(USDC_HOLDER);
    recipient = await getSigner();

    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
    await vault.connect(recipient).setRelayerApproval(recipient.address, relayer.address, true);
  });

  it('should wrap successfully', async () => {
    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    const balanceOfYearnBefore = await yearnToken.balanceOf(recipient.address);
    const expectedBalanceOfYearnAfter = Math.floor((1e6 / (await yearnToken.pricePerShare())) * amountToWrap);

    expect(balanceOfYearnBefore).to.be.equal(0);

    // Approving vault to pull tokens from user.
    await usdcToken.connect(sender).approve(vault.address, amountToWrap);

    chainedReference = toChainedReference(30);
    const depositIntoYearn = library.interface.encodeFunctionData('wrapYearn', [
      yvUSDC,
      sender.address,
      recipient.address,
      amountToWrap,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([depositIntoYearn]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    const balanceOfYearnAfter = await yearnToken.balanceOf(recipient.address);

    expect(balanceOfUSDCBefore.sub(balanceOfUSDCAfter)).to.be.equal(amountToWrap);
    expect(balanceOfYearnAfter).to.be.almostEqual(expectedBalanceOfYearnAfter);
  });

  it('should unwrap successfully', async () => {
    const YearnAmountToWithdraw = Math.floor((1e6 / (await yearnToken.pricePerShare())) * amountToWrap);

    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    const balanceOfYearnBefore = await yearnToken.balanceOf(recipient.address);

    expect(balanceOfYearnBefore).to.be.almostEqual(YearnAmountToWithdraw);

    const withdrawFromYearn = library.interface.encodeFunctionData('unwrapYearn', [
      yvUSDC,
      recipient.address,
      sender.address,
      chainedReference,
      0,
    ]);

    await yearnToken.connect(recipient).approve(vault.address, MAX_UINT256);

    await relayer.connect(recipient).multicall([withdrawFromYearn]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    const balanceOfYearnAfter = await yearnToken.balanceOf(recipient.address);

    expect(balanceOfYearnAfter).to.be.equal(0);
    expect(balanceOfUSDCAfter.sub(balanceOfUSDCBefore)).to.be.almostEqual(amountToWrap);
  });
});

function toChainedReference(key: BigNumberish): BigNumber {
  const CHAINED_REFERENCE_PREFIX = 'ba10';
  // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
  const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

  return BigNumber.from(paddedPrefix).add(key);
}
