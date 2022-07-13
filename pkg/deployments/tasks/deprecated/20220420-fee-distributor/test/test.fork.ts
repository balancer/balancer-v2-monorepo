import hre from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { advanceToTimestamp, currentWeekTimestamp, DAY, WEEK } from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task, { TaskMode } from '../../../../src/task';
import { getForkedNetwork } from '../../../../src/test';
import { impersonate } from '../../../../src/signers';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';

describe('FeeDistributor', function () {
  let veBALHolder: SignerWithAddress, veBALHolder2: SignerWithAddress, feeCollector: SignerWithAddress;
  let distributor: Contract;

  let VEBAL: Contract, BAL: Contract, WETH: Contract;

  const task = new Task('20220420-fee-distributor', TaskMode.TEST, getForkedNetwork(hre));

  const VEBAL_HOLDER = '0xCB3593C7c0dFe13129Ff2B6add9bA402f76c797e';
  const VEBAL_HOLDER_2 = '0x49a2dcc237a65cc1f412ed47e0594602f6141936';
  const PROTOCOL_FEE_COLLECTOR = '0xce88686553686da562ce7cea497ce749da109f9f';

  const BAL_ADDRESS = '0xba100000625a3754423978a60c9317c58a424e3D';
  const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  const balAmount = fp(42);
  const wethAmount = fp(13.37);

  let firstWeek: BigNumber;

  before('run task', async () => {
    await task.run({ force: true });
    distributor = await task.instanceAt('FeeDistributor', task.output({ network: 'test' }).FeeDistributor);
  });

  before('setup accounts', async () => {
    veBALHolder = await impersonate(VEBAL_HOLDER, fp(100));
    veBALHolder2 = await impersonate(VEBAL_HOLDER_2, fp(100));
    feeCollector = await impersonate(PROTOCOL_FEE_COLLECTOR, fp(100));
  });

  before('setup contracts', async () => {
    const veBALTask = new Task('20220325-gauge-controller', TaskMode.READ_ONLY, getForkedNetwork(hre));
    VEBAL = await veBALTask.instanceAt('VotingEscrow', await veBALTask.output({ network: 'mainnet' }).VotingEscrow);

    // We reuse this task as it contains an ABI similar to the one in real ERC20 tokens
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    BAL = await testBALTokenTask.instanceAt('TestBalancerToken', BAL_ADDRESS);
    WETH = await testBALTokenTask.instanceAt('TestBalancerToken', WETH_ADDRESS);
  });

  context('in the first week', () => {
    before(async () => {
      firstWeek = await currentWeekTimestamp();
    });

    context('with BAL distributed', () => {
      before('send BAL to distribute', async () => {
        await BAL.connect(feeCollector).approve(distributor.address, balAmount);
        await distributor.connect(feeCollector).depositToken(BAL.address, balAmount);
      });

      it('veBAL holders cannot yet claim tokens', async () => {
        const balancesBefore = await Promise.all([BAL, WETH].map((token) => token.balanceOf(veBALHolder.address)));
        const tx = await distributor.claimTokens(veBALHolder.address, [BAL.address, WETH.address]);
        const balancesAfter = await Promise.all([BAL, WETH].map((token) => token.balanceOf(veBALHolder.address)));

        expectEvent.notEmitted(await tx.wait(), 'TokensClaimed');

        expect(balancesAfter).to.deep.equal(balancesBefore);
      });
    });
  });

  context('in the second week', () => {
    before('advance time', async () => {
      // 1 day into the second week
      await advanceToTimestamp(firstWeek.add(WEEK).add(DAY));
    });

    context('with WETH distributed', () => {
      before('send BAL to distribute', async () => {
        await BAL.connect(feeCollector).approve(distributor.address, balAmount.mul(3));
        await distributor.connect(feeCollector).depositToken(BAL.address, balAmount.mul(3));
      });

      before('send WETH to distribute', async () => {
        await WETH.connect(feeCollector).approve(distributor.address, wethAmount);
        await distributor.connect(feeCollector).depositToken(WETH.address, wethAmount);
      });

      it('veBAL holders can claim BAL and not WETH', async () => {
        const holderFirstWeekBalance = await VEBAL['balanceOf(address,uint256)'](veBALHolder.address, firstWeek);
        const firstWeekSupply = await VEBAL['totalSupply(uint256)'](firstWeek);
        const expectedBALAmount = balAmount.mul(holderFirstWeekBalance).div(firstWeekSupply);

        const wethBalanceBefore = await WETH.balanceOf(veBALHolder.address);
        const tx = await distributor.claimTokens(veBALHolder.address, [BAL.address, WETH.address]);
        const wethBalanceAfter = await WETH.balanceOf(veBALHolder.address);

        expectTransferEvent(
          await tx.wait(),
          { from: distributor.address, to: veBALHolder.address, value: expectedBALAmount },
          BAL.address
        );
        expect(wethBalanceAfter).to.equal(wethBalanceBefore);
      });
    });
  });

  context('in the third week', () => {
    before('advance time', async () => {
      // 1 day into the third week
      await advanceToTimestamp(firstWeek.add(2 * WEEK).add(DAY));
    });

    it('veBAL holders can claim BAL and WETH', async () => {
      const secondWeek = firstWeek.add(WEEK);
      const holderSecondWeekBalance = await VEBAL['balanceOf(address,uint256)'](veBALHolder.address, secondWeek);
      const secondWeekSupply = await VEBAL['totalSupply(uint256)'](secondWeek);

      const expectedBALAmount = balAmount.mul(3).mul(holderSecondWeekBalance).div(secondWeekSupply);
      const expectedWETHAmount = wethAmount.mul(holderSecondWeekBalance).div(secondWeekSupply);

      const tx = await distributor.claimTokens(veBALHolder.address, [BAL.address, WETH.address]);

      expectTransferEvent(
        await tx.wait(),
        { from: distributor.address, to: veBALHolder.address, value: expectedBALAmount },
        BAL.address
      );

      expectTransferEvent(
        await tx.wait(),
        { from: distributor.address, to: veBALHolder.address, value: expectedWETHAmount },
        WETH.address
      );
    });

    it('veBAL holders can claim all the BAL and WETH at once', async () => {
      const holderFirstWeekBalance = await VEBAL['balanceOf(address,uint256)'](veBALHolder2.address, firstWeek);
      const firstWeekSupply = await VEBAL['totalSupply(uint256)'](firstWeek);
      const balFirstWeekAmount = balAmount.mul(holderFirstWeekBalance).div(firstWeekSupply);

      const secondWeek = firstWeek.add(WEEK);
      const holderSecondWeekBalance = await VEBAL['balanceOf(address,uint256)'](veBALHolder2.address, secondWeek);
      const secondWeekSupply = await VEBAL['totalSupply(uint256)'](secondWeek);
      const balSecondWeekAmount = balAmount.mul(3).mul(holderSecondWeekBalance).div(secondWeekSupply);

      const expectedBALAmount = balFirstWeekAmount.add(balSecondWeekAmount);
      const expectedWETHAmount = wethAmount.mul(holderSecondWeekBalance).div(secondWeekSupply);

      const tx = await distributor.claimTokens(veBALHolder2.address, [BAL.address, WETH.address]);

      expectTransferEvent(
        await tx.wait(),
        { from: distributor.address, to: veBALHolder2.address, value: expectedBALAmount },
        BAL.address
      );

      expectTransferEvent(
        await tx.wait(),
        { from: distributor.address, to: veBALHolder2.address, value: expectedWETHAmount },
        WETH.address
      );
    });
  });
});
