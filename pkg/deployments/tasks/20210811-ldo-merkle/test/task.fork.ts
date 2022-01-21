import hre, { ethers } from 'hardhat';
import { Contract, BigNumber, utils } from 'ethers';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { expectEqualWithError } from '@balancer-labs/v2-helpers/src/test/relativeError';
import { MerkleTree } from '@balancer-labs/v2-distributors/lib/merkleTree';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

import Task from '../../../src/task';
import { getForkedNetwork } from '../../../src/test';
import { getSigner, impersonate } from '../../../src/signers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

function encodeElement(address: string, balance: BigNumber): string {
  return ethers.utils.solidityKeccak256(['address', 'uint'], [address, balance]);
}

describe('MerkleRedeem', function () {
  let lp: SignerWithAddress, other: SignerWithAddress, whale: SignerWithAddress;
  let distributor: Contract, token: Contract;

  const task = Task.forTest('20210811-ldo-merkle', getForkedNetwork(hre));

  const LDO_TOKEN_ADDRESS = '0x5a98fcbea516cf06857215779fd812ca3bef1b32'; // LDO
  const LDO_WHALE_ADDRESS = '0x3e40d73eb977dc6a537af587d48316fee66e9c8c';

  before('run task', async () => {
    await task.run({ force: true });
    distributor = await task.instanceAt('MerkleRedeem', task.output().MerkleRedeem);
  });

  before('load signers and transfer ownership', async () => {
    lp = await getSigner(2);
    other = await getSigner(3);
    whale = await impersonate(LDO_WHALE_ADDRESS);
    token = await task.instanceAt('IERC20', LDO_TOKEN_ADDRESS);

    await distributor.transferOwnership(whale.address);
    await token.connect(whale).approve(distributor.address, MAX_UINT256);
  });

  describe('with an allocation defined', async () => {
    let root: string;
    let proof: string[];

    before(() => {
      const elements: string[] = [encodeElement(lp.address, fp(66)), encodeElement(other.address, fp(34))];

      const merkleTree = new MerkleTree(elements);
      root = merkleTree.getHexRoot();

      proof = merkleTree.getHexProof(elements[0]);
    });

    it('can seed an allocation', async () => {
      await distributor.connect(whale).seedAllocations(bn(0), root, fp(100));

      const expectedReward = fp(100);
      expectEqualWithError(await token.balanceOf(distributor.address), expectedReward, fp(1));
    });

    it('can claim a reward', async () => {
      await distributor.connect(whale).seedAllocations(bn(1), root, fp(100));

      await distributor.connect(lp).claimWeek(lp.address, bn(1), fp(66), proof);
      expectEqualWithError(await token.balanceOf(lp.address), fp(66), fp(1));
    });

    it('can claim a reward to a callback', async () => {
      await distributor.connect(whale).seedAllocations(bn(2), root, fp(100));

      const calldata = utils.defaultAbiCoder.encode([], []);
      const callbackContract = await deploy('v2-distributors/MockRewardCallback', { args: [] });

      const claims = [{ week: bn(2), balance: fp(66), merkleProof: proof }];

      await distributor.connect(lp).claimWeeksWithCallback(lp.address, callbackContract.address, calldata, claims);
      expectEqualWithError(await token.balanceOf(callbackContract.address), fp(66), fp(1));
    });
  });
});
