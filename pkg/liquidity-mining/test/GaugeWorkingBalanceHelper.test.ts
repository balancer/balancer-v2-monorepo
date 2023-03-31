import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp } from '@balancer-labs/v2-helpers/src/numbers';
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
  let admin: SignerWithAddress, user: SignerWithAddress, other: SignerWithAddress;
  let adaptor: Contract;
  let pool: Contract;
  let boost: Contract;
  let gaugeController: Contract;

  before('setup signers', async () => {
    [, admin, user, other] = await ethers.getSigners();
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

  describe('getWorkingBalances', () => {
    let gaugeImplementation: Contract;
    let gaugeFactory: Contract;
    let gauge: Contract;

    async function deployHelper(mainnet: boolean) {
      workingBalanceHelper = await deploy('GaugeWorkingBalanceHelper', { args: [veDelegationProxy.address, mainnet] });
    }

    function itStoresParameters(mainnet: boolean) {
      it('stores the veDelegationProxy', async () => {
        expect(await workingBalanceHelper.getVotingEscrowDelegationProxy()).to.equal(veDelegationProxy.address);
      });

      it('stores the votingEscrow', async () => {
        expect(await workingBalanceHelper.getVotingEscrow()).to.equal(votingEscrow.address);
      });

      it('indicates the network', async () => {
        expect(await workingBalanceHelper.onMainnet()).to.equal(mainnet);
      });
    }

    function itComputesWorkingBalances() {
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

      sharedBeforeEach('deposit into gauge', async () => {
        await depositIntoGauge(user, fp(5));
        await depositIntoGauge(other, fp(10));
      });

      sharedBeforeEach('lock BPT into VotingEscrow', async () => {
        const bptAmount = fp(10);

        await createLockForUser(user, bptAmount, 365 * DAY);
        await createLockForUser(other, bptAmount.mul(2), 365 * DAY);

        expect(await votingEscrow['balanceOf(address)'](user.address)).to.be.gt(0, 'zero veBAL balance');
        expect(await votingEscrow['balanceOf(address)'](other.address)).to.be.gt(0, 'zero veBAL balance');

        expect(await votingEscrow['totalSupply()']()).to.be.gt(0, 'zero veBAL supply');
      });

      it('computes values', async () => {
        const [current, projected] = await workingBalanceHelper.getWorkingBalances(gauge.address, user.address);
        expect(projected).to.gt(current);
      });

      it('values change over time', async () => {
        await advanceTime(180 * DAY);
        await gauge.connect(user).user_checkpoint(user.address);

        const [current, projected] = await workingBalanceHelper.getWorkingBalances(gauge.address, user.address);
        expect(projected).to.almostEqual(current);
      });
    }

    context('on L1', () => {
      const relativeWeightCap = fp(0.1);

      sharedBeforeEach('deploy helper', async () => {
        await deployHelper(true);
      });

      itStoresParameters(true);

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

      let pseudoMinter: Contract;

      sharedBeforeEach('deploy helper', async () => {
        await deployHelper(false);
      });

      itStoresParameters(false);

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
});
