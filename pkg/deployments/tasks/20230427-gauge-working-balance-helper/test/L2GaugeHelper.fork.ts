import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { getForkedNetwork, Task, TaskMode, describeForkTest, getSigners, impersonate } from '../../../src';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { FP_ONE, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';

describeForkTest('GaugeWorkingBalanceHelper-L2', 'polygon', 42002545, function () {
  let workingBalanceHelper: Contract;
  let veDelegationProxy: Contract;
  let votingEscrow: Contract;
  let gauge: Contract;
  let lpTokenHolder: SignerWithAddress;
  let veBALHolder: SignerWithAddress;
  let lpToken: Contract;

  const GAUGE = '0x1f0ee42d005b89814a01f050416b28c3142ac900';
  const LP_TOKEN = '0x924ec7ed38080e40396c46f6206a6d77d0b9f72d';
  const LP_TOKEN_HOLDER = '0x9824697f7c12cabada9b57842060931c48dea969';

  let task: Task;

  before('run task', async () => {
    task = new Task('20230427-gauge-working-balance-helper', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    workingBalanceHelper = await task.deployedInstance('GaugeWorkingBalanceHelper');
  });

  describe('getters', () => {
    it('stores the veDelegationProxy', async () => {
      expect(await workingBalanceHelper.getVotingEscrowDelegationProxy()).to.equal(veDelegationProxy.address);
    });

    it('stores the votingEscrow', async () => {
      expect(await workingBalanceHelper.getVotingEscrow()).to.equal(votingEscrow.address);
    });

    it('indicates where to read supply from', async () => {
      expect(await workingBalanceHelper.readsTotalSupplyFromVE()).to.be.false;
    });
  });

  before('setup accounts', async () => {
    [, veBALHolder] = await getSigners();

    lpTokenHolder = await impersonate(LP_TOKEN_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    const proxyTask = new Task('20230316-l2-ve-delegation-proxy', TaskMode.READ_ONLY, getForkedNetwork(hre));
    veDelegationProxy = await proxyTask.deployedInstance('VotingEscrowDelegationProxy');
    votingEscrow = await proxyTask.deployedInstance('NullVotingEscrow');
    gauge = await task.instanceAt('ChildChainGauge', GAUGE);
    lpToken = await deployedAt('IERC20', LP_TOKEN);
  });

  context('with no veBAL', () => {
    const stakeAmount = fp(100);

    before('stake in gauge', async () => {
      await lpToken.connect(lpTokenHolder).transfer(veBALHolder.address, stakeAmount);
      await lpToken.connect(veBALHolder).approve(gauge.address, MAX_UINT256);

      await gauge.connect(veBALHolder)['deposit(uint256)'](stakeAmount);
    });

    it('projected balance should equal current', async () => {
      const [currentWorkingBalance, projectedWorkingBalance] = await workingBalanceHelper.getWorkingBalances(
        gauge.address,
        veBALHolder.address
      );

      // Ensure we have equal balances (that are non-zero)
      expect(projectedWorkingBalance).to.eq(currentWorkingBalance);
      expect(projectedWorkingBalance).to.gt(0);
    });

    it('ratios should equal 1', async () => {
      const [current, projected] = await workingBalanceHelper.getWorkingBalanceToSupplyRatios(
        gauge.address,
        veBALHolder.address
      );

      expect(projected).to.eq(current);
      expect(projected).to.eq(FP_ONE);
    });
  });
});
