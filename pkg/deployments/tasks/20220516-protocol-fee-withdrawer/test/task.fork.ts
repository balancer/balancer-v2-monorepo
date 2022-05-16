import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { Interface } from 'ethers/lib/utils';

describe('ProtocolFeeWithdrawer', function () {
  let govMultisig: SignerWithAddress;

  let vault: Contract, authorizer: Contract;
  let protocolFeesCollector: Contract, protocolFeesWithdrawer: Contract;

  const task = new Task('20220516-protocol-fee-withdrawer', TaskMode.TEST, getForkedNetwork(hre));

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  before('run task', async () => {
    await task.run({ force: true });
    protocolFeesWithdrawer = await task.deployedInstance('ProtocolFeesWithdrawer');
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    protocolFeesCollector = await vaultTask.instanceAt('ProtocolFeesCollector', await vault.getProtocolFeesCollector());
  });

  before('grant permissions', async () => {
    govMultisig = await impersonate(GOV_MULTISIG, fp(100));

    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());

    // Approve ProtocolFeesWithdrawer to withdraw from ProtocolFeesCollector.
    const unsafeWithdrawCollectedFeesRole = await actionId(protocolFeesCollector, 'withdrawCollectedFees');
    await authorizer.connect(govMultisig).grantRoles([unsafeWithdrawCollectedFeesRole], protocolFeesWithdrawer.address);

    // Approve Governance Multisig to withdraw using ProtocolFeesWithdrawer.
    const safeWithdrawCollectedFeesRole = await actionId(protocolFeesWithdrawer, 'withdrawCollectedFees');
    const denylistTokenRole = await actionId(protocolFeesWithdrawer, 'denylistToken');
    const allowlistTokenRole = await actionId(protocolFeesWithdrawer, 'allowlistToken');
    await authorizer
      .connect(govMultisig)
      .grantRoles([safeWithdrawCollectedFeesRole, denylistTokenRole, allowlistTokenRole], govMultisig.address);
  });

  it('shows that tokens are not withdrawable', async () => {
    const initialDeniedTokens = task.input().InitialDeniedTokens;
    for (const token of initialDeniedTokens) {
      expect(await protocolFeesWithdrawer.isWithdrawableToken(token)).to.be.false;
    }
    expect(await protocolFeesWithdrawer.isWithdrawableTokens(initialDeniedTokens)).to.be.false;
  });

  it('prevents withdrawing the initially denylisted tokens', async () => {
    const initialDeniedTokens = task.input().InitialDeniedTokens;
    await expect(
      protocolFeesWithdrawer.connect(govMultisig).withdrawCollectedFees(
        initialDeniedTokens,
        initialDeniedTokens.map(() => 1),
        GOV_MULTISIG
      )
    ).to.be.revertedWith('Attempting to withdraw denylisted token');
  });

  it('more tokens can added to the denylist', async () => {
    expect(await protocolFeesWithdrawer.isWithdrawableToken(WETH)).to.be.true;

    await protocolFeesWithdrawer.connect(govMultisig).denylistToken(WETH);

    expect(await protocolFeesWithdrawer.isWithdrawableToken(WETH)).to.be.false;
    await expect(
      protocolFeesWithdrawer.connect(govMultisig).withdrawCollectedFees([WETH], [1], GOV_MULTISIG)
    ).to.be.revertedWith('Attempting to withdraw denylisted token');
  });

  it('tokens can be later removed from the denylist', async () => {
    await protocolFeesWithdrawer.connect(govMultisig).allowlistToken(WETH);

    const wethTx = await protocolFeesWithdrawer.connect(govMultisig).withdrawCollectedFees([WETH], [1], GOV_MULTISIG);
    expectEvent.inIndirectReceipt(
      await wethTx.wait(),
      new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
      'Transfer',
      {
        from: protocolFeesCollector.address,
        to: GOV_MULTISIG,
        value: 1,
      }
    );

    const initialDeniedTokens = task.input().InitialDeniedTokens;
    const deniedToken = initialDeniedTokens[0];
    await protocolFeesWithdrawer.connect(govMultisig).allowlistToken(deniedToken);

    const tokenTx = await protocolFeesWithdrawer
      .connect(govMultisig)
      .withdrawCollectedFees([deniedToken], [1], GOV_MULTISIG);
    expectEvent.inIndirectReceipt(
      await tokenTx.wait(),
      new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']),
      'Transfer',
      {
        from: protocolFeesCollector.address,
        to: GOV_MULTISIG,
        value: 1,
      }
    );
  });

  it('prevents unauthorized accounts from withdrawing protocol fees', async () => {
    const unauthorizedWithdrawer = await getSigner();

    await expect(
      protocolFeesWithdrawer
        .connect(unauthorizedWithdrawer)
        .withdrawCollectedFees([WETH], [1], unauthorizedWithdrawer.address)
    ).to.be.revertedWith('BAL#401'); // SENDER_NOT_ALLOWED
  });
});
