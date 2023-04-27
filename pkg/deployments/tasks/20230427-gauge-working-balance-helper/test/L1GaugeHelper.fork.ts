import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { getForkedNetwork, Task, TaskMode, describeForkTest, getSigners, impersonate } from '../../../src';
import { deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { fp, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { MONTH, currentTimestamp } from '@balancer-labs/v2-helpers/src/time';

describeForkTest('GaugeWorkingBalanceHelper-L1', 'mainnet', 16627100, function () {
  let workingBalanceHelper: Contract;
  let veDelegationProxy: Contract;
  let votingEscrow: Contract;
  let veBALHolder: SignerWithAddress;
  let lpTokenHolder: SignerWithAddress;
  let vault: Contract;
  let gauge: Contract;
  let bal80weth20Pool: Contract;
  let lpToken: Contract;
  let BAL: string;
  let task: Task;

  const VEBAL_POOL = '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56';
  const VAULT_BOUNTY = fp(1000);

  const LP_TOKEN = '0x7B50775383d3D6f0215A8F290f2C9e2eEBBEceb2';
  const LP_TOKEN_HOLDER = '0x16224283bE3f7C0245d9D259Ea82eaD7fcB8343d';

  const GAUGE = '0x68d019f64a7aa97e2d4e7363aee42251d08124fb';

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
    [, veBALHolder] = await getSigners();

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
    gauge = await task.instanceAt('LiquidityGaugeV5', GAUGE);
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
  });

  context('with veBAL', () => {
    const TOKENLESS_PRODUCTION = 0.4;
    const MAX_BALANCE_RATIO = 1 / TOKENLESS_PRODUCTION;

    before('create veBAL whale', async () => {
      bal80weth20Pool = await deployedAt('v2-pool-weighted/WeightedPool', VEBAL_POOL);
      const poolId = await bal80weth20Pool.getPoolId();

      await vault.connect(veBALHolder).joinPool(
        poolId,
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

      await bal80weth20Pool.connect(veBALHolder).approve(votingEscrow.address, MAX_UINT256);
      const currentTime = await currentTimestamp();
      await votingEscrow
        .connect(veBALHolder)
        .create_lock(await bal80weth20Pool.balanceOf(veBALHolder.address), currentTime.add(MONTH * 12));
    });

    it(`projected ratio should be greater than current by the maximum ratio (${MAX_BALANCE_RATIO})`, async () => {
      const [currentWorkingBalance, projectedWorkingBalance] = await workingBalanceHelper.getWorkingBalances(
        gauge.address,
        veBALHolder.address
      );

      expect(fromFp(projectedWorkingBalance) / fromFp(currentWorkingBalance)).to.eq(MAX_BALANCE_RATIO);
    });

    context('updates after checkpointing', () => {
      before('checkpoint', async () => {
        await gauge.connect(veBALHolder).user_checkpoint(veBALHolder.address);
      });

      it('projected balance should be close to or less than current', async () => {
        const [currentWorkingBalance, projectedWorkingBalance] = await workingBalanceHelper.getWorkingBalances(
          gauge.address,
          veBALHolder.address
        );

        expect(projectedWorkingBalance).to.be.almostEqual(currentWorkingBalance);
        expect(projectedWorkingBalance).to.be.gt(0);
        expect(projectedWorkingBalance).to.be.lte(currentWorkingBalance);
      });

      it('current and projected ratios should now be equal', async () => {
        const [current, projected] = await workingBalanceHelper.getWorkingBalanceToSupplyRatios(
          gauge.address,
          veBALHolder.address
        );

        expect(projected).to.eq(current);
      });
    });
  });
});
