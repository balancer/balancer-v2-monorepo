import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode, getSigner } from '../../../src';

describeForkTest('SiloWrapping', 'mainnet', 16622559, function () {
  let task: Task;
  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const USDC_HOLDER = '0xda9ce944a37d218c3302f6b82a094844c6eceb17';
  const sUSDC = '0x416DE9AD46C53AAAb2352F91120952393946d2ac';
  const USDC_SILO = '0xfccc27aabd0ab7a0b2ad2b7760037b1eab61616b';

  let usdcToken: Contract, shareToken: Contract, silo: Contract;
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
    shareToken = await task.instanceAt('IShareToken', sUSDC);
    silo = await task.instanceAt('ISilo', USDC_SILO);
    sender = await impersonate(USDC_HOLDER);
    recipient = await getSigner();

    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
    await vault.connect(recipient).setRelayerApproval(recipient.address, relayer.address, true);
  });

  it('should wrap successfully', async () => {
    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    const balanceOfWrappedBefore = await shareToken.balanceOf(recipient.address);

    expect(balanceOfWrappedBefore).to.be.equal(0);

    // Approving vault to pull tokens from user.
    await usdcToken.connect(sender).approve(vault.address, amountToWrap);

    chainedReference = toChainedReference(30);
    const depositIntoSilo = library.interface.encodeFunctionData('wrapShareToken', [
      sUSDC,
      sender.address,
      recipient.address,
      amountToWrap,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([depositIntoSilo]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    const balanceOfWrappedAfter = await shareToken.balanceOf(recipient.address);

    const estimatedRate = await siloExchangeRate(silo, USDC, shareToken);

    const expectedBalanceOfWrappedAfter = bn(estimatedRate).mul(amountToWrap);

    expect(balanceOfUSDCBefore.sub(balanceOfUSDCAfter)).to.be.equal(amountToWrap);
    expect(balanceOfWrappedAfter).to.be.almostEqual(expectedBalanceOfWrappedAfter, 0.01);
  });

  it('should unwrap successfully', async () => {
    const estimatedRate = await siloExchangeRate(silo, USDC, shareToken);
    const wrappedRate = Math.floor(1e6 / estimatedRate);
    const balanceOfWrappedBefore = await shareToken.balanceOf(recipient.address);

    const amountToWithdraw = Math.floor((wrappedRate * balanceOfWrappedBefore) / 1e6);

    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);

    const withdrawFromSilo = library.interface.encodeFunctionData('unwrapShareToken', [
      sUSDC,
      recipient.address,
      sender.address,
      amountToWithdraw,
      chainedReference,
    ]);

    await shareToken.connect(recipient).approve(vault.address, amountToWithdraw);

    await relayer.connect(recipient).multicall([withdrawFromSilo]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    const balanceOfWrappedAfter = await shareToken.balanceOf(recipient.address);

    expect(balanceOfWrappedBefore.sub(balanceOfWrappedAfter)).to.be.equal(amountToWithdraw);
    // Because rate is very close to 1
    expect(balanceOfUSDCAfter.sub(balanceOfUSDCBefore)).to.be.almostEqual(amountToWithdraw);
  });
});

function toChainedReference(key: BigNumberish): BigNumber {
  const CHAINED_REFERENCE_PREFIX = 'ba10';
  // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
  const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

  return BigNumber.from(paddedPrefix).add(key);
}

async function siloExchangeRate(silo: Contract, mainTokenAddress: string, wrappedTokenContract: Contract) {
  const assetSotrage = await silo.assetStorage(mainTokenAddress);
  const totalAmount = assetSotrage[3];
  const totalShares = await wrappedTokenContract.totalSupply();
  return totalAmount / totalShares;
}
