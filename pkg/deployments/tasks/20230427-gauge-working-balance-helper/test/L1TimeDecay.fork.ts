import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { getForkedNetwork, Task, TaskMode, describeForkTest, getSigners, impersonate } from '../../../src';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { fp, fpMul } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MONTH, WEEK, advanceTime, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describeForkTest('GaugeWorkingBalanceHelper-L1-TimeDecay', 'mainnet', 17258776, function () {
  let workingBalanceHelper: Contract;
  let veDelegationProxy: Contract;
  let votingEscrow: Contract;
  let veBALHolder: SignerWithAddress;
  let lpTokenHolder: SignerWithAddress;
  let other: SignerWithAddress;
  let vault: Contract;
  let gauge: Contract;
  let lpToken: Contract;
  let BAL: string;
  let task: Task;

  const VEBAL_POOL_ID = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014';
  const VAULT_BOUNTY = fp(1000);

  const LP_TOKEN = '0xbc5F4f9332d8415AAf31180Ab4661c9141CC84E4';
  const LP_TOKEN_HOLDER = '0x24Dd242c3c4061b1fCaA5119af608B56afBaEA95';

  const LOCK_PERIOD = MONTH * 12;

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
      expect(await workingBalanceHelper.readsTotalSupplyFromVE()).to.be.true;
    });
  });

  before('setup accounts', async () => {
    [, veBALHolder, other] = await getSigners();

    veBALHolder = await impersonate(veBALHolder.address, VAULT_BOUNTY.add(fp(5))); // plus gas
    lpTokenHolder = await impersonate(LP_TOKEN_HOLDER, fp(100));
  });

  before('setup contracts', async () => {
    vault = await new Task('20210418-vault', TaskMode.READ_ONLY, getForkedNetwork(hre)).deployedInstance('Vault');

    veDelegationProxy = await new Task(
      '20220325-ve-delegation',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('VotingEscrowDelegationProxy');

    votingEscrow = await new Task(
      '20220325-gauge-controller',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('VotingEscrow');

    const BALTokenAdmin = await new Task(
      '20220325-balancer-token-admin',
      TaskMode.READ_ONLY,
      getForkedNetwork(hre)
    ).deployedInstance('BalancerTokenAdmin');

    BAL = await BALTokenAdmin.getBalancerToken();

    lpToken = await deployedAt('IERC20', LP_TOKEN);
  });

  before('create gauge', async () => {
    const gaugeFactoryTask = new Task('20220822-mainnet-gauge-factory-v2', TaskMode.READ_ONLY, getForkedNetwork(hre));
    const factory = await gaugeFactoryTask.deployedInstance('LiquidityGaugeFactory');
    const weightCap = fp(0.001);

    // Create the Gauge, vs using an existing one, so that we can control the total balance
    const tx = await factory.create(LP_TOKEN, weightCap);
    const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

    gauge = await gaugeFactoryTask.instanceAt('LiquidityGaugeV5', event.args.gauge);
    expect(await gauge.lp_token()).to.equal(LP_TOKEN);

    expect(await factory.isGaugeFromFactory(gauge.address)).to.be.true;
  });

  const stakeAmount = fp(100);

  before('stake in gauge', async () => {
    await lpToken.connect(lpTokenHolder).transfer(veBALHolder.address, stakeAmount);
    await lpToken.connect(lpTokenHolder).transfer(other.address, stakeAmount);

    await lpToken.connect(lpTokenHolder).approve(gauge.address, MAX_UINT256);
    await lpToken.connect(veBALHolder).approve(gauge.address, MAX_UINT256);
    await lpToken.connect(other).approve(gauge.address, MAX_UINT256);

    await gauge.connect(lpTokenHolder)['deposit(uint256)'](stakeAmount.mul(100));
    await gauge.connect(veBALHolder)['deposit(uint256)'](stakeAmount);
    await gauge.connect(other)['deposit(uint256)'](stakeAmount);
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

  context('with veBAL', () => {
    let bal80weth20Pool: Contract;
    let whaleBalance;

    before('create veBAL whale', async () => {
      const [poolAddress] = await vault.getPool(VEBAL_POOL_ID);

      bal80weth20Pool = await deployedAt('IERC20', poolAddress);

      await vault.connect(veBALHolder).joinPool(
        VEBAL_POOL_ID,
        veBALHolder.address,
        veBALHolder.address,
        {
          assets: [BAL, ZERO_ADDRESS],
          maxAmountsIn: [0, VAULT_BOUNTY],
          fromInternalBalance: false,
          userData: WeightedPoolEncoder.joinExactTokensInForBPTOut([0, VAULT_BOUNTY], 0),
        },
        { value: VAULT_BOUNTY }
      );

      const totalBalance = await bal80weth20Pool.balanceOf(veBALHolder.address);
      whaleBalance = fpMul(totalBalance, fp(0.99));
      const otherBalance = totalBalance.sub(whaleBalance);

      await bal80weth20Pool.connect(veBALHolder).transfer(other.address, otherBalance);

      await bal80weth20Pool.connect(veBALHolder).approve(votingEscrow.address, MAX_UINT256);
      await bal80weth20Pool.connect(other).approve(votingEscrow.address, MAX_UINT256);

      const currentTime = await currentTimestamp();
      await votingEscrow.connect(other).create_lock(otherBalance, currentTime.add(LOCK_PERIOD));
    });

    it('veBAL decay affects projected balances', async () => {
      const [, projectedBalanceBefore] = await workingBalanceHelper.getWorkingBalances(gauge.address, other.address);
      const [, projectedRatioBefore] = await workingBalanceHelper.getWorkingBalanceToSupplyRatios(
        gauge.address,
        other.address
      );

      await gauge.connect(other).user_checkpoint(other.address);
      await workingBalanceHelper.getWorkingBalances(gauge.address, other.address);

      await votingEscrow.connect(veBALHolder).create_lock(whaleBalance, (await currentTimestamp()).add(LOCK_PERIOD));
      await advanceTime(WEEK);

      const [currentBalanceAfter, projectedBalanceAfter] = await workingBalanceHelper.getWorkingBalances(
        gauge.address,
        other.address
      );
      const [, projectedRatioAfter] = await workingBalanceHelper.getWorkingBalanceToSupplyRatios(
        gauge.address,
        other.address
      );

      // Projections should be uniformly lower
      expect(projectedBalanceAfter).to.be.lt(projectedBalanceBefore);
      expect(projectedRatioAfter).to.be.lt(projectedRatioBefore);

      // Should be close a week after checkpointing
      expect(currentBalanceAfter).to.be.almostEqual(projectedBalanceBefore);
    });
  });
});
