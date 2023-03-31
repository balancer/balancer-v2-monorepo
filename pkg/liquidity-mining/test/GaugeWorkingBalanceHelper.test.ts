import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { parseFixed } from '@ethersproject/bignumber';
import { deploy, deployedAt } from '@balancer-labs/v2-helpers/src/contract';
import { expect } from 'chai';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import { ANY_ADDRESS, MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import { BigNumberish, fp, FP_ONE } from '@balancer-labs/v2-helpers/src/numbers';
import { sharedBeforeEach } from '@balancer-labs/v2-common/sharedBeforeEach';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { advanceTime, currentTimestamp, DAY } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

describe('GaugeWorkingBalanceHelper', () => {
  let bpt: Token;
  let votingEscrow: Contract;
  let veBoostProxy: Contract;
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
    BAL = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer', 'BAL'] });
    pool = await deploy('TestBalancerToken', { args: [admin.address, 'Balancer-LP0', 'LP0'] });
    bpt = await Token.create('BAL/WETH');

    adaptor = vault.authorizerAdaptor;
  });
  
  sharedBeforeEach('deploy VotingEscrow, proxy, and helper', async () => {
    votingEscrow = await deploy('VotingEscrow', {
      args: [bpt.address, 'Vote Escrowed Balancer BPT', 'veBAL', adaptor.address],
    });

    gaugeController = await deploy('MockGaugeController', { args: [votingEscrow.address, adaptor.address] });
    // Type weight is ignored in the mock controller.
    await gaugeController.add_type('Ethereum', 0);

    boost = await deploy('VeBoostV2', { args: [votingEscrow.address, gaugeController.address] });

    veBoostProxy = await deploy('VotingEscrowDelegationProxy', {
      args: [vault.address, votingEscrow.address, ZERO_ADDRESS], // boost.address?
    });

    workingBalanceHelper = await deploy('GaugeWorkingBalanceHelper', { args: [veBoostProxy.address, true]});
  });

  it('stores the veDelegationProxy', async () => {
    expect(await workingBalanceHelper.getVotingEscrowDelegationProxy()).to.equal(veBoostProxy.address);
  });

  it('stores the votingEscrow', async () => {
    expect(await workingBalanceHelper.getVotingEscrow()).to.equal(votingEscrow.address);
  });

  it('stores level 1 or 2', async () => {
    expect(await workingBalanceHelper.onMainnet()).to.be.true;
  });

  describe('getWorkingBalances', () => {
    async function createLockForUser(
      user: SignerWithAddress,
      amount: BigNumberish,
      lockDuration: BigNumberish
    ): Promise<void> {
      await bpt.mint(user, amount);
      await bpt.approve(votingEscrow, amount, { from: user });
      const now = await currentTimestamp();
      await votingEscrow.connect(user).create_lock(amount, now.add(lockDuration));
    }

    context('on L1', () => {
      const relativeWeightCap = fp(0.1);
      
      let liquidityGaugeImplementation: Contract;
      let liquidityGaugeFactory: Contract;
      let gauge: Contract;

      sharedBeforeEach('deploy gauge and factory', async () => {
        const balTokenAdmin = await deploy('MockBalancerTokenAdmin', { args: [vault.address, BAL.address] });
        const balMinter = await deploy('MainnetBalancerMinter', { args: [balTokenAdmin.address, gaugeController.address] });

        liquidityGaugeImplementation = await deploy('LiquidityGaugeV5', {
          args: [balMinter.address, veBoostProxy.address, adaptor.address],
        });
        liquidityGaugeFactory = await deploy('LiquidityGaugeFactory', { args: [liquidityGaugeImplementation.address] });

        const tx = await liquidityGaugeFactory.create(pool.address, relativeWeightCap);
        const event = expectEvent.inReceipt(await tx.wait(), 'GaugeCreated');

        const gaugeAddress = event.args.gauge;
        gauge = await deployedAt('LiquidityGaugeV5', gaugeAddress);
      });

      sharedBeforeEach('lock BPT into VotingEscrow', async () => {
        const bptAmount = fp(10);

        await createLockForUser(user, bptAmount, 365 * DAY);
        await createLockForUser(other, bptAmount.mul(2), 365 * DAY);

        expect(await votingEscrow['balanceOf(address)'](user.address)).to.be.gt(0, 'zero veBAL balance');
        expect(await votingEscrow['totalSupply()']()).to.be.gt(0, 'zero veBAL supply');
      });

      sharedBeforeEach('deposit into gauge', async () => {
        const stakeAmount = fp(5);
        const otherStakeAmount = fp(10);

        await pool.connect(admin).mint(user.address, stakeAmount);
        await pool.connect(admin).mint(other.address, otherStakeAmount);

        await pool.connect(user).approve(gauge.address, stakeAmount);
        await pool.connect(other).approve(gauge.address, otherStakeAmount);

        await gauge.connect(user)['deposit(uint256)'](stakeAmount);
        await gauge.connect(other)['deposit(uint256)'](otherStakeAmount);
      });

      it('computes values', async () => {
        const [ current, projected ] = await workingBalanceHelper.getWorkingBalances(gauge.address, user.address);
        console.log(`current: ${current}`);
        console.log(`projected: ${projected}`);
        expect(projected).to.gt(current);
      });

      it('values change over time', async () => {
        await advanceTime(180 * DAY);
        await gauge.connect(user).user_checkpoint(user.address);

        const [ current, projected ] = await workingBalanceHelper.getWorkingBalances(gauge.address, user.address);
        console.log(`current: ${current}`);
        console.log(`projected: ${projected}`);
        expect(projected).to.almostEqual(current);
      })
    });

    context('on L2', () => {
    });
  });
});
