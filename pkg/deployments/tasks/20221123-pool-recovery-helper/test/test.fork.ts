import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode, getSigner } from '../../../src';
import { setCode } from '@nomicfoundation/hardhat-network-helpers';
import { Interface } from '@ethersproject/abi';

describeForkTest('PoolRecoveryHelper', 'mainnet', 15998800, function () {
  let task: Task;

  let helper: Contract;
  let operator: SignerWithAddress, admin: SignerWithAddress;
  let authorizer: Contract;

  const POOL_STABLE = '0xbD482fFb3E6E50dC1c437557C3Bea2B68f3683Ee'; // From ComposableStablePoolFactory
  const POOL_WEIGHTED = '0xe340EBfcAA544da8bB1Ee9005F1a346D50Ec422e'; // From WeightedPoolFactory

  before('run task', async () => {
    task = new Task('20221123-pool-recovery-helper', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    helper = await task.deployedInstance('PoolRecoveryHelper');
  });

  before('load vault', async () => {
    const authorizerTask = new Task('20210418-authorizer', TaskMode.READ_ONLY, getForkedNetwork(hre));
    authorizer = await authorizerTask.deployedInstance('Authorizer');
  });

  before('load signers', async () => {
    // We impersonate an account with the default admin role in order to be able to grant permissions. This assumes
    // such an account exists.
    admin = await impersonate(await authorizer.getRoleMember(await authorizer.DEFAULT_ADMIN_ROLE(), 0));
    operator = await getSigner();
  });

  before('approve helper at the authorizer', async () => {
    const selector = new Interface(task.artifact('IRecoveryMode').abi).getSighash('enableRecoveryMode()');

    const actionIds = await Promise.all(
      [POOL_STABLE, POOL_WEIGHTED].map(async (poolAddress) => {
        const pool = await task.instanceAt('IAuthentication', poolAddress);
        return await pool.getActionId(selector);
      })
    );

    // Grant helper permission to enable recovery mode
    await authorizer.connect(admin).grantRoles(actionIds, helper.address);
  });

  before('approve operator at the authorizer', async () => {
    const actionIds = await Promise.all(
      ['addPoolFactory', 'removePoolFactory'].map(async (method) => actionId(helper, method))
    );
    await authorizer.connect(admin).grantRoles(actionIds, operator.address);
  });
  context('with ComposableStablePool', () => {
    itWorksWithPool(POOL_STABLE);
  });

  context('with WeightedPool', () => {
    itWorksWithPool(POOL_WEIGHTED);
  });

  function itWorksWithPool(poolAddress: string) {
    it('recognizes pools from the initial factories', async () => {
      expect(await helper.isPoolFromKnownFactory(poolAddress)).to.equal(true);
    });

    it("reverts if the pool rate providers don't revert", async () => {
      await expect(helper.enableRecoveryMode(poolAddress)).to.be.revertedWith("Pool's rate providers do not revert");
    });

    it('puts the pool in recovery mode if one of the rate providers reverts', async () => {
      // We get the first non-zero rate provider of the Pool, and replace it with a mock one that reverts
      const rateProviderPool = await task.instanceAt('IRateProviderPool', poolAddress);
      const rateProviders: string[] = await rateProviderPool.getRateProviders();
      const mockedRateProvider: string = rateProviders.filter((provider) => provider !== ZERO_ADDRESS)[0];

      // Make sure there's at least one rate provider
      expect(mockedRateProvider).to.not.equal(undefined);

      await setCode(mockedRateProvider, (await task.artifact('MockRevertingRateProvider')).deployedBytecode);
      const mockLendingPool = await task.instanceAt('MockRevertingRateProvider', mockedRateProvider);
      await mockLendingPool.setRevertOnGetRate(true);

      await helper.enableRecoveryMode(poolAddress);

      const recoveryModePool = await task.instanceAt('IRecoveryMode', poolAddress);
      expect(await recoveryModePool.inRecoveryMode()).to.equal(true);
    });
  }
});
