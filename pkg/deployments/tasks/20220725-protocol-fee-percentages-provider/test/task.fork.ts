import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { BigNumber, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { describeForkTest } from '../../../src/forkTests';
import Task, { TaskMode } from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describeForkTest('ProtocolFeePercentagesProvider', 'mainnet', 15130000, function () {
  let admin: SignerWithAddress;
  let protocolFeePercentagesProvider: Contract;
  let vault: Contract, authorizer: Contract, feesCollector: Contract;

  let task: Task;

  enum FeeType {
    Swap = 0,
    FlashLoan = 1,
    Yield = 2,
    AUM = 3,
  }

  before('run task', async () => {
    task = new Task('20220725-protocol-fee-percentages-provider', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    protocolFeePercentagesProvider = await task.deployedInstance('ProtocolFeePercentagesProvider');
  });

  before('setup accounts', async () => {
    admin = await getSigner(0);
  });

  before('setup contracts', async () => {
    const vaultTask = new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre));
    vault = await vaultTask.deployedInstance('Vault');
    authorizer = await vaultTask.instanceAt('Authorizer', await vault.getAuthorizer());
    feesCollector = await vaultTask.instanceAt('ProtocolFeesCollector', await vault.getProtocolFeesCollector());
  });

  before('setup admin', async () => {
    const DEFAULT_ADMIN_ROLE = await authorizer.DEFAULT_ADMIN_ROLE();
    admin = await impersonate(await authorizer.getRoleMember(DEFAULT_ADMIN_ROLE, 0), fp(100));
  });

  context('without permissions', () => {
    itRevertsSettingFee(FeeType.Yield, fp(0.0157));

    itRevertsSettingFee(FeeType.Swap, fp(0.0126));
  });

  context('with setFeeTypePercentage permission', () => {
    before('grant setFeePercentage permission to admin', async () => {
      await authorizer
        .connect(admin)
        .grantRole(await actionId(protocolFeePercentagesProvider, 'setFeeTypePercentage'), admin.address);
    });

    itSetsFeeCorrectly(FeeType.Yield, fp(0.1537));

    itRevertsSettingFee(FeeType.Swap, fp(0.0857));

    context('with swapFeePercentage permission', () => {
      before('grant setSwapFeePercentage permission to fees provider', async () => {
        await authorizer
          .connect(admin)
          .grantRole(await actionId(feesCollector, 'setSwapFeePercentage'), protocolFeePercentagesProvider.address);
      });

      itSetsFeeCorrectly(FeeType.Swap, fp(0.0951));
    });
  });

  function itSetsFeeCorrectly(feeType: FeeType, fee: BigNumber): void {
    it(`set ${FeeType[feeType]} fee`, async () => {
      await protocolFeePercentagesProvider.connect(admin).setFeeTypePercentage(feeType, fee);
      expect(await protocolFeePercentagesProvider.getFeeTypePercentage(feeType)).to.be.eq(fee);
    });
  }

  function itRevertsSettingFee(feeType: FeeType, fee: BigNumber): void {
    it(`revert setting ${FeeType[feeType]} fee`, async () => {
      expect(protocolFeePercentagesProvider.connect(admin).setFeeTypePercentage(feeType, fee)).to.be.revertedWith(
        'BAL#401'
      );
    });
  }
});
