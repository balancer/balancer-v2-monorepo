import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';

describeForkTest('EulerWrapping', 'mainnet', 16622559, function () {
  let task: Task;
  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199';
  const eUSDC = '0xEb91861f8A4e1C12333F42DCE8fB0Ecdc28dA716'; //proxy

  let usdcToken: Contract, wrappedToken: Contract, eToken: Contract, eulerProtocol: Contract;
  let sender: SignerWithAddress;
  let chainedReference: BigNumber;
  let chainedReferenceOut: BigNumber;

  const amountToWrap = 100e6; //100 USDC
  // TODO: run tests with higher amount

  before('run task', async () => {
    task = new Task('20230214-euler-batch-relayer', TaskMode.TEST, getForkedNetwork(hre));
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
    wrappedToken = await task.instanceAt('IERC20', eUSDC);
    eToken = await task.instanceAt('IEulerToken', eUSDC);
    //eulerProtocol = await task.instanceAt('IGearboxVault', await dieselToken.owner());
    sender = await impersonate(USDC_HOLDER);

    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
  });

  it('should wrap successfully', async () => {
    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfeUSDClBefore = await wrappedToken.balanceOf(relayer.address);

    expect(balanceOfeUSDClBefore).to.be.equal(0);

    // Approving vault to pull tokens from user.
    await usdcToken.connect(sender).approve(vault.address, amountToWrap);

    chainedReference = toChainedReference(30);
    const depositIntoEuler = library.interface.encodeFunctionData('wrapEuler', [
      eUSDC,
      sender.address,
      relayer.address,
      amountToWrap,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([depositIntoEuler]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfeUSDCAfter = await wrappedToken.balanceOf(relayer.address);

    // @param underlyingAmount Amount in underlying units (same decimals as underlying token)
    // @return eToken balance, in internal book-keeping units (18 decimals)
    const expectedbalanceOfeUSDCAfter = await eToken.convertUnderlyingToBalance(amountToWrap);

    expect(balanceOfUSDCBefore - balanceOfUSDCAfter).to.be.equal(amountToWrap);
    expect(balanceOfeUSDCAfter).to.be.equal(expectedbalanceOfeUSDCAfter);
  });

  it('should unwrap successfully', async () => {
    // in underlying decimals
    const eAmountToWithdraw = await eToken.convertUnderlyingToBalance(amountToWrap);
    const balanceOfUSDCBefore = await usdcToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfeUSDCBefore = await wrappedToken.balanceOf(relayer.address);

    expect(balanceOfeUSDCBefore).to.be.equal(eAmountToWithdraw);

    const withdrawFromEuler = library.interface.encodeFunctionData('unwrapEuler', [
      eUSDC,
      relayer.address,
      sender.address,
      chainedReference,
      0,
    ]);

    await relayer.connect(sender).multicall([withdrawFromEuler]);

    const balanceOfUSDCAfter = await usdcToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfeUSDCAfter = await wrappedToken.balanceOf(relayer.address);

    expect(balanceOfeUSDCAfter).to.be.equal(0);
    expect(balanceOfUSDCAfter - balanceOfUSDCBefore).to.be.equal(amountToWrap);
  });

  it('should wrap and unwrap', async () => {
    chainedReference = toChainedReference(30);
    chainedReferenceOut = toChainedReference(80);
    await usdcToken.connect(sender).approve(vault.address, amountToWrap * 3);

    const depositIntoEuler_1 = library.interface.encodeFunctionData('wrapEuler', [
      eUSDC,
      sender.address,
      relayer.address,
      amountToWrap,
      chainedReference,
    ]);

    const withdrawFromEuler = library.interface.encodeFunctionData('unwrapEuler', [
      eUSDC,
      relayer.address,
      sender.address,
      chainedReference,
      chainedReferenceOut,
    ]);

    const depositIntoEuler_2 = library.interface.encodeFunctionData('wrapEuler', [
      eUSDC,
      sender.address,
      relayer.address,
      chainedReferenceOut,
      0,
    ]);

    await relayer.connect(sender).multicall([depositIntoEuler_1, withdrawFromEuler, depositIntoEuler_2]);
  });
});

function toChainedReference(key: BigNumberish): BigNumber {
  const CHAINED_REFERENCE_PREFIX = 'ba10';
  // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
  const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

  return BigNumber.from(paddedPrefix).add(key);
}
