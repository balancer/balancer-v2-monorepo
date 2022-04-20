import hre from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { BigNumber, fp, FP_SCALING_FACTOR } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import {
  advanceTime,
  advanceToTimestamp,
  currentTimestamp,
  currentWeekTimestamp,
  DAY,
  WEEK,
} from '@balancer-labs/v2-helpers/src/time';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import Task from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';
import _, { first, range } from 'lodash';

describe.only('FeeDistributor', function () {
  let veBALHolder: SignerWithAddress, feeCollector: SignerWithAddress;
  let distributor: Contract;

  let VEBAL: Contract, BAL: Contract, WETH: Contract;

  const task = Task.forTest('20220420-fee-distributor', getForkedNetwork(hre));

  const VEBAL_HOLDER = '0xCB3593C7c0dFe13129Ff2B6add9bA402f76c797e';
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
    feeCollector = await impersonate(PROTOCOL_FEE_COLLECTOR, fp(100));
  });

  before('setup contracts', async () => {
    const veBALTask = Task.forTest('20220325-gauge-controller', getForkedNetwork(hre));
    VEBAL = await veBALTask.instanceAt('VotingEscrow', await veBALTask.output({ network: 'mainnet' }).VotingEscrow);

    // We reuse this task as it contains an ABI similar to the one in real ERC20 tokens
    const testBALTokenTask = Task.forTest('20220325-test-balancer-token', getForkedNetwork(hre));
    BAL = await testBALTokenTask.instanceAt('TestBalancerToken', BAL_ADDRESS);
    WETH = await testBALTokenTask.instanceAt('TestBalancerToken', WETH_ADDRESS);
  });

  context('in the first week', () => {
    before(async () => {
      firstWeek = await currentWeekTimestamp();
    });

    context('with BAL distributed', () => {
      before('send BAL to distribute', async () => {
        await BAL.connect(feeCollector).transfer(distributor.address, balAmount);
        await distributor.checkpointToken(BAL.address);
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

  context('in the next week', () => {
    before('advance time', async () => {
      // 1 day into the second week
      await advanceToTimestamp(firstWeek.add(WEEK).add(DAY));
    });

    context('with WETH distributed', () => {
      before('send WETH to distribute', async () => {
        await distributor.checkpointToken(WETH.address);
        await WETH.connect(feeCollector).transfer(distributor.address, wethAmount);
        await distributor.checkpointToken(WETH.address);
      });

      it('veBAL holders can claim BAL and not WETH', async () => {
        const holderFirstWeekBalance = await VEBAL['balanceOf(address,uint256)'](veBALHolder.address, firstWeek);
        const firstWeekSupply = await VEBAL['totalSupply(uint256)'](firstWeek);
        const expectedBALAmount = balAmount.mul(holderFirstWeekBalance).div(firstWeekSupply);

        const wethBalanceBefore = await WETH.balanceOf(veBALHolder.address);
        const tx = await distributor.claimTokens(veBALHolder.address, [BAL.address, WETH.address]);
        const wethBalanceAfter = await WETH.balanceOf(veBALHolder.address);

        expectEvent.inIndirectReceipt(
          await tx.wait(),
          BAL.interface,
          'Transfer',
          { from: distributor.address, to: veBALHolder.address, value: expectedBALAmount },
          BAL.address
        );

        expect(wethBalanceAfter).to.equal(wethBalanceBefore);
      });
    });
  });
});
