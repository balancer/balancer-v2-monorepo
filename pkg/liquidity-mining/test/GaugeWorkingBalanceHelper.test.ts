import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp, FP_ONE, fromFp } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';

describe('GaugeWorkingBalanceHelper', () => {
  let bpt8020: Token;
  let votingEscrow: Contract;
  let veDelegationProxy: Contract;
  let vault: Vault;
  let BAL: Contract;
  let workingBalanceHelper: Contract;
  let admin: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress, another: SignerWithAddress;
  let adaptor: Contract;
  let pool: Contract;
  let boost: Contract;
  let gaugeController: Contract;
  let gaugeImplementation: Contract;
  let gaugeFactory: Contract;
  let gauge: Contract;

  before('setup signers', async () => {
    [, admin, user, other, another] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy Vault and tokens', async () => {
    vault = await Vault.create({ admin });
    adaptor = vault.authorizerAdaptor;

    BAL = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
    bpt8020 = await Token.create('BAL/WETH 80/20');

    pool = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer-Incentivized', 'LP0'] });
  });

  sharedBeforeEach('deploy infrastructure and veDelegationProxy', async () => {
    votingEscrow = await deploy('VotingEscrow', {
      args: [bpt8020.address, 'Vote Escrowed Balancer BPT', 'veBAL', adaptor.address],
    });

    gaugeController = await deploy('MockGaugeController', { args: [votingEscrow.address, adaptor.address] });
    // Type weight is ignored in the mock controller.
    await gaugeController.add_type('Ethereum', 0);

    const proxyV1 = await deploy('VotingEscrowDelegationProxy', {
      args: [vault.address, votingEscrow.address, ZERO_ADDRESS],
    });

    boost = await deploy('VeBoostV2', { args: [proxyV1.address, votingEscrow.address] });

    veDelegationProxy = await deploy('VotingEscrowDelegationProxy', {
      args: [vault.address, votingEscrow.address, boost.address],
    });
  });

  async function deployHelper(readTotalSupplyFromVE: boolean) {
    workingBalanceHelper = await deploy('GaugeWorkingBalanceHelper', {
      args: [veDelegationProxy.address, readTotalSupplyFromVE],
    });
  }

  function itStoresParameters(readTotalSupplyFromVE: boolean) {
    it('stores the veDelegationProxy', async () => {
      expect(await workingBalanceHelper.getVotingEscrowDelegationProxy()).to.equal(veDelegationProxy.address);
    });

    it('stores the votingEscrow', async () => {
      expect(await workingBalanceHelper.getVotingEscrow()).to.equal(votingEscrow.address);
    });

    it('indicates where to read supply from', async () => {
      expect(await workingBalanceHelper.readsTotalSupplyFromVE()).to.equal(readTotalSupplyFromVE);
    });
  }

  const randomInt = (max: number) => Math.floor(Math.random() * Math.floor(max));

  function itComputesWorkingBalances() {
    const TOKENLESS_PRODUCTION = 0.4;
    const MAX_BALANCE_RATIO = 1 / TOKENLESS_PRODUCTION;
    const LOCK_PERIOD = (185 + randomInt(180)) * DAY;
    const stakeAmount = fp(5);
    const bptAmount = fp(10);

    async function createLockForUser(
      account: SignerWithAddress,
      amount: BigNumberish,
      lockDuration: BigNumberish
    ): Promise<void> {
      await bpt8020.mint(account, amount);
      await bpt8020.approve(votingEscrow, amount, { from: account });
      const now = await currentTimestamp();
      await votingEscrow.connect(account).create_lock(amount, now.add(lockDuration));
    }

    async function depositIntoGauge(account: SignerWithAddress, stakeAmount: BigNumberish) {
      await pool.connect(admin).mint(account.address, stakeAmount);
      await pool.connect(account).approve(gauge.address, stakeAmount);
      await gauge.connect(account)['deposit(uint256)'](stakeAmount);
    }

    function currentBalanceEqualsProjected() {
      it('projected balance should equal current', async () => {
        const [currentWorkingBalance, projectedWorkingBalance] = await workingBalanceHelper.getWorkingBalances(
          gauge.address,
          user.address
        );

        // Ensure we have equal balances (that are non-zero)
        expect(projectedWorkingBalance).to.eq(currentWorkingBalance);
        expect(projectedWorkingBalance).to.gt(0);
      });
    }

    function currentRatioEqualsProjected() {
      it('current and projected ratios should be 1', async () => {
        const [current, projected] = await workingBalanceHelper.getWorkingBalanceToSupplyRatios(
          gauge.address,
          user.address
        );

        // Ensure we have equal ratios (that equal 1)
        expect(projected).to.eq(current);
        expect(projected).to.eq(FP_ONE);
      });
    }

    function projectedRatioIncreases() {
      it('projected ratio should be larger than current', async () => {
        const [current, projected] = await workingBalanceHelper.getWorkingBalanceToSupplyRatios(
          gauge.address,
          user.address
        );

        expect(projected).to.gt(current);
      });
    }

    function projectedRatioIsMaxedOut() {
      it(`projected ratio should be greater than current by the maximum ratio (${MAX_BALANCE_RATIO})`, async () => {
        const [currentWorkingBalance, projectedWorkingBalance] = await workingBalanceHelper.getWorkingBalances(
          gauge.address,
          user.address
        );

        expect(fromFp(projectedWorkingBalance) / fromFp(currentWorkingBalance)).to.eq(MAX_BALANCE_RATIO);
      });
    }

    function projectedBalanceIsIncreased(maxPctIncrease: number) {
      it(`projected balance should be slightly more than current, by less than ${maxPctIncrease}%`, async () => {
        const [currentWorkingBalance, projectedWorkingBalance] = await workingBalanceHelper.getWorkingBalances(
          gauge.address,
          user.address
        );

        expect(projectedWorkingBalance).to.be.gt(currentWorkingBalance);

        const ratio = fromFp(projectedWorkingBalance) / fromFp(currentWorkingBalance);

        expect(ratio).to.be.lt(1 + maxPctIncrease / 100);
      });
    }

    function currentShouldAlmostEqualProjected() {
      it('projected balance should be close to or less than current', async () => {
        const [currentWorkingBalance, projectedWorkingBalance] = await workingBalanceHelper.getWorkingBalances(
          gauge.address,
          user.address
        );

        expect(projectedWorkingBalance).to.be.almostEqual(currentWorkingBalance);
        expect(projectedWorkingBalance).to.be.gt(0);
        expect(projectedWorkingBalance).to.be.lte(currentWorkingBalance);
      });
    }

    function itUpdatesAfterCheckpointing() {
      context('when checkpointed', () => {
        sharedBeforeEach('checkpoint user', async () => {
          await gauge.connect(user).user_checkpoint(user.address);
        });

        currentShouldAlmostEqualProjected();
      });
    }

    function veBALDecaysOverTime() {
      it('veBAL decays over time', async () => {
        const [, projectedBalanceBefore] = await workingBalanceHelper.getWorkingBalances(gauge.address, user.address);
        const [, projectedRatioBefore] = await workingBalanceHelper.getWorkingBalanceToSupplyRatios(
          gauge.address,
          user.address
        );

        // Checkpoint user, add another contribution to maintain the total supply, and advance time
        await gauge.connect(user).user_checkpoint(user.address);
        await createLockForUser(another, bptAmount.mul(100), LOCK_PERIOD);
        await advanceTime(LOCK_PERIOD / 2);

        const [currentBalanceAfter, projectedBalanceAfter] = await workingBalanceHelper.getWorkingBalances(
          gauge.address,
          user.address
        );
        const [, projectedRatioAfter] = await workingBalanceHelper.getWorkingBalanceToSupplyRatios(
          gauge.address,
          user.address
        );

        // Projections should be uniformly lower
        expect(projectedBalanceAfter).to.be.lt(projectedBalanceBefore);
        expect(projectedRatioAfter).to.be.lt(projectedRatioBefore);

        // Should be equal after checkpoint
        expect(projectedBalanceBefore).to.be.eq(currentBalanceAfter);
      });
    }

    describe('with no veBAL', () => {
      context('check raw balances', () => {
        sharedBeforeEach('deposit', async () => {
          depositIntoGauge(user, stakeAmount);
        });

        currentBalanceEqualsProjected();
      });

      context('check balance ratios', () => {
        sharedBeforeEach('deposit', async () => {
          depositIntoGauge(user, stakeAmount);
        });

        currentRatioEqualsProjected();
      });
    });

    describe('with a veBAL monopoly', () => {
      sharedBeforeEach('deposit', async () => {
        await depositIntoGauge(user, stakeAmount);
        await createLockForUser(user, bptAmount, LOCK_PERIOD);
      });

      projectedRatioIsMaxedOut();

      itUpdatesAfterCheckpointing();

      currentRatioEqualsProjected();
    });

    describe('with 1% veBAL', () => {
      sharedBeforeEach('deposit', async () => {
        // Another person stakes 100x as much
        await depositIntoGauge(user, stakeAmount);
        await depositIntoGauge(other, stakeAmount);

        await createLockForUser(user, bptAmount, LOCK_PERIOD);
        await createLockForUser(other, bptAmount.mul(100), LOCK_PERIOD);
      });

      // Should be less than 5%
      projectedBalanceIsIncreased(5);

      projectedRatioIncreases();

      itUpdatesAfterCheckpointing();

      veBALDecaysOverTime();
    });
  }

  context('on L1', () => {
    const relativeWeightCap = fp(0.1);
    const readTotalSupplyFromVe = true;

    sharedBeforeEach('deploy helper', async () => {
      await deployHelper(readTotalSupplyFromVe);
    });

    itStoresParameters(readTotalSupplyFromVe);

    sharedBeforeEach('deploy gauge and factory', async () => {
      const balTokenAdmin = await deploy('MockBalancerTokenAdmin', { args: [vault.address, BAL.address] });
      const balMinter = await deploy('MainnetBalancerMinter', {
        args: [balTokenAdmin.address, gaugeController.address],
      });

      gaugeImplementation = await deploy('LiquidityGaugeV5', {
        args: [balMinter.address, veDelegationProxy.address, adaptor.address],
      });
      gaugeFactory = await deploy('LiquidityGaugeFactory', { args: [gaugeImplementation.address] });

      const tx = await gaugeFactory.create(pool.address, relativeWeightCap);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

      gauge = await deployedAt('LiquidityGaugeV5', event.args.gauge);
    });

    itComputesWorkingBalances();
  });

  context('on L2', () => {
    const version = JSON.stringify({
      name: 'ChildChainGauge',
      version: '0',
      deployment: 'test-deployment',
    });

    // Setting the readTotalSupplyFromVE to false reads from the proxy instead
    const readTotalSupplyFromProxy = false;

    let pseudoMinter: Contract;

    sharedBeforeEach('deploy helper', async () => {
      await deployHelper(readTotalSupplyFromProxy);
    });

    itStoresParameters(readTotalSupplyFromProxy);

    sharedBeforeEach('deploy gauge and factory', async () => {
      pseudoMinter = await deploy('L2BalancerPseudoMinter', { args: [vault.address, BAL.address] });

      gaugeImplementation = await deploy('ChildChainGauge', {
        args: [veDelegationProxy.address, pseudoMinter.address, adaptor.address, version],
      });
      gaugeFactory = await deploy('ChildChainGaugeFactory', {
        args: [gaugeImplementation.address, version, version],
      });

      await vault.grantPermissionGlobally(await actionId(pseudoMinter, 'addGaugeFactory'), admin.address);
      await pseudoMinter.connect(admin).addGaugeFactory(gaugeFactory.address);
    });

    sharedBeforeEach('create gauge', async () => {
      const tx = await gaugeFactory.create(pool.address);
      const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

      gauge = await deployedAt('ChildChainGauge', event.args.gauge);
    });

    itComputesWorkingBalances();
  });
});
