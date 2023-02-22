import fs from 'fs';
import path from 'path';

import hre from 'hardhat';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { expectTransferEvent } from '@balancer-labs/v2-helpers/src/test/expectTransfer';

import { describeForkTest, impersonate, getForkedNetwork, Task, TaskMode } from '../../../src';
import { MerkleTree } from './merkleTree';

describeForkTest('MerkleOrchard V2', 'mainnet', 16684000, function () {
  let distributor: SignerWithAddress;
  let merkleOrchard: Contract;
  let ldoToken: Contract;

  let task: Task;

  const LDO_ADDRESS = '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32';
  // Root taken from https://github.com/balancer-labs/bal-mining-scripts/blob/incident-response/reports/_incident-response/_roots-lido.json.
  const LDO_ROOT = '0x748ae6b1a5704a0711f56bd6b109627ab0d39ae6c0eee11d85450fba7979c8ec';

  const GOV_MULTISIG = '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f';

  const elements: string[] = [];
  const pendingClaims: PendingClaim[] = [];
  let merkleTree: MerkleTree;
  let distributorLdoBalance: BigNumber;

  type PendingClaim = {
    address: string;
    amount: BigNumber;
  };

  before('run task', async () => {
    task = new Task('20230222-merkle-orchard-v2', TaskMode.TEST, getForkedNetwork(hre));
    await task.run({ force: true });
    merkleOrchard = await task.deployedInstance('MerkleOrchard');
  });

  before('setup accounts', async () => {
    [, distributor] = await ethers.getSigners();
    distributor = await impersonate(GOV_MULTISIG, fp(10));
  });

  before('setup contracts', async () => {
    // We use test balancer token to make use of the ERC-20 interface.
    const testBALTokenTask = new Task('20220325-test-balancer-token', TaskMode.READ_ONLY, getForkedNetwork(hre));
    ldoToken = await testBALTokenTask.instanceAt('TestBalancerToken', LDO_ADDRESS);
  });

  before('compute merkle tree', async () => {
    // Data taken from https://github.com/balancer-labs/bal-mining-scripts/blob/incident-response/reports/_incident-response/1/__ethereum_0x5a98fcbea516cf06857215779fd812ca3bef1b32.json.
    const filePath = path.join(task.dir(), 'test/data/ldo-claims.json');

    const ldoClaims = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let totalClaimableAmount = bn(0);
    Object.entries(ldoClaims).forEach(([address, amount]) => {
      const amountFp = fp(Number(amount));
      totalClaimableAmount = totalClaimableAmount.add(amountFp);
      pendingClaims.push({ address, amount: amountFp });
      elements.push(encodeElement(address, amountFp));
    });
    merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();
    await expect(root).to.be.eq(LDO_ROOT);

    // Distributor LDO balance is slightly less than total balance calculated from pending claims.
    distributorLdoBalance = await ldoToken.balanceOf(distributor.address);
    expect(distributorLdoBalance).to.be.equalWithError(totalClaimableAmount);
  });

  it('stores an allocation', async () => {
    await ldoToken.connect(distributor).approve(merkleOrchard.address, distributorLdoBalance);
    await merkleOrchard.connect(distributor).createDistribution(LDO_ADDRESS, LDO_ROOT, distributorLdoBalance, bn(1));

    const proof = merkleTree.getHexProof(elements[0]);

    const result = await merkleOrchard.verifyClaim(
      LDO_ADDRESS,
      distributor.address,
      1,
      pendingClaims[0].address,
      pendingClaims[0].amount,
      proof
    );
    expect(result).to.equal(true);
  });

  it('allows the user to claim a single distribution', async () => {
    const claimerId = 13;
    const claim = pendingClaims[claimerId];
    const merkleProof = merkleTree.getHexProof(elements[claimerId]);

    const claimer = await impersonate(claim.address, fp(10));
    const claims = [
      {
        distributionId: bn(1),
        balance: claim.amount,
        distributor: distributor.address,
        tokenIndex: 0,
        merkleProof,
      },
    ];

    const tx = await merkleOrchard.connect(claimer).claimDistributions(claimer.address, claims, [LDO_ADDRESS]);
    await expectTransferEvent(
      await tx.wait(),
      { from: await merkleOrchard.getVault(), to: claimer.address, value: claim.amount },
      ldoToken
    );
  });

  it('reverts when claiming twice in the same transaction', async () => {
    const claimerId = 17;
    const claim = pendingClaims[claimerId];
    const merkleProof = merkleTree.getHexProof(elements[claimerId]);

    const claimer = await impersonate(claim.address, fp(10));
    const claims = [
      {
        distributionId: bn(1),
        balance: claim.amount,
        distributor: distributor.address,
        tokenIndex: 0,
        merkleProof,
      },
      {
        distributionId: bn(1),
        balance: claim.amount,
        distributor: distributor.address,
        tokenIndex: 0,
        merkleProof,
      },
    ];

    await expect(
      merkleOrchard.connect(claimer).claimDistributions(claimer.address, claims, [LDO_ADDRESS])
    ).to.be.revertedWith('cannot claim twice');
  });

  function encodeElement(address: string, balance: BigNumber): string {
    return ethers.utils.solidityKeccak256(['address', 'uint'], [address, balance]);
  }
});
