import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';

describeForkTest('CompoundV2Wrapping', 'polygon', 40305420, function () {
  let task: Task;
  let relayer: Contract, library: Contract;
  let vault: Contract, authorizer: Contract;

  const BRZ = '0x491a4eB4f1FC3BfF8E1d2FC856a6A46663aD556f';
  const BRZ_HOLDER = '0xB90B2050C955cd899b9BC8B5C743c25770EBc8AA';
  const cBRZ = '0x2e4659b451C3ba2E72D79aAf267cFc09BCCc9d7c';

  let brzToken: Contract, cToken: Contract;
  let sender: SignerWithAddress;
  let chainedReference: BigNumber;
  const amountToWrap = bn(1000e4); // BRZ is 4 decimals

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
    brzToken = await task.instanceAt('IERC20', BRZ);
    cToken = await task.instanceAt('ICToken', cBRZ);
    sender = await impersonate(BRZ_HOLDER);

    await vault.connect(sender).setRelayerApproval(sender.address, relayer.address, true);
  });

  it('should wrap successfully', async () => {
    const balanceOfbrzBefore = await brzToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfcbrzBefore = await cToken.balanceOf(relayer.address);

    expect(balanceOfcbrzBefore).to.be.equal(0);

    // Approving vault to pull tokens from user.
    await brzToken.connect(sender).approve(vault.address, amountToWrap);

    chainedReference = toChainedReference(80);
    const depositIntoMidas = library.interface.encodeFunctionData('wrapCompoundV2', [
      cBRZ,
      sender.address,
      relayer.address,
      amountToWrap,
      chainedReference,
    ]);

    await relayer.connect(sender).multicall([depositIntoMidas]);

    const balanceOfbrzAfter = await brzToken.balanceOf(sender.address);
    expect(balanceOfbrzBefore.sub(balanceOfbrzAfter)).to.be.equal(amountToWrap);
  });

  it('should unwrap successfully', async () => {
    const balanceOfbrzBefore = await brzToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const cbrzAmountToWithdraw = await cToken.balanceOf(relayer.address);
    const balanceOfcbrzBefore = await cToken.balanceOf(relayer.address);

    expect(balanceOfcbrzBefore).to.be.equal(cbrzAmountToWithdraw);

    const withdrawFromMidas = library.interface.encodeFunctionData('unwrapCompoundV2', [
      cBRZ,
      relayer.address,
      sender.address,
      chainedReference,
      0,
    ]);

    await relayer.connect(sender).multicall([withdrawFromMidas]);

    const balanceOfbrzAfter = await brzToken.balanceOf(sender.address);
    // Relayer will be the contract receiving the wrapped tokens
    const balanceOfcbrzbAfter = await cToken.balanceOf(relayer.address);

    expect(balanceOfcbrzbAfter).to.be.equal(0);
    expect(balanceOfbrzAfter.sub(balanceOfbrzBefore)).to.be.almostEqual(amountToWrap, 0.01);
  });
});

function toChainedReference(key: BigNumberish): BigNumber {
  const CHAINED_REFERENCE_PREFIX = 'ba10';
  // The full padded prefix is 66 characters long, with 64 hex characters and the 0x prefix.
  const paddedPrefix = `0x${CHAINED_REFERENCE_PREFIX}${'0'.repeat(64 - CHAINED_REFERENCE_PREFIX.length)}`;

  return BigNumber.from(paddedPrefix).add(key);
}
