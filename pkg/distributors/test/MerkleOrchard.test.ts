import { ethers } from 'hardhat';
import { BytesLike, BigNumber } from 'ethers';
import { expect } from 'chai';
import { Contract, utils } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';

import { BigNumberish, bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MerkleTree } from '../lib/merkleTree';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

function encodeElement(address: string, balance: BigNumber): string {
  return ethers.utils.solidityKeccak256(['address', 'uint'], [address, balance]);
}

interface Claim {
  distributionId: BigNumberish;
  balance: BigNumber;
  distributor: string;
  tokenIndex: number;
  merkleProof: BytesLike[];
}

describe('MerkleOrchard', () => {
  let tokens: TokenList, token: Token, vault: Contract, merkleOrchard: Contract, tokenAddresses: string[];

  let admin: SignerWithAddress,
    distributor: SignerWithAddress,
    lp1: SignerWithAddress,
    lp2: SignerWithAddress,
    other: SignerWithAddress;
  const tokenInitialBalance = bn(100e18);

  before('setup', async () => {
    [, admin, distributor, lp1, lp2, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and tokens', async () => {
    const vaultHelper = await Vault.create({ admin });
    vault = vaultHelper.instance;

    tokens = await TokenList.create(['DAI'], { sorted: true });
    token = tokens.DAI;
    tokenAddresses = [token.address];

    merkleOrchard = await deploy('MerkleOrchard', {
      args: [vault.address],
      from: admin,
    });
    await tokens.mint({ to: distributor.address, amount: tokenInitialBalance });
    await tokens.approve({ to: merkleOrchard.address, from: [distributor] });
  });

  describe('seedAllocations', () => {
    const claimBalance: BigNumberish = bn('9876');
    const root = '0xba10000000000000000000000000000000000000000000000000000000000001';
    const root2 = '0xba10000000000000000000000000000000000000000000000000000000000002';

    it('records the expected merkle tree root', async () => {
      await merkleOrchard.connect(distributor).seedAllocations(token.address, root, claimBalance, 0);
      await merkleOrchard.connect(distributor).seedAllocations(token.address, root2, claimBalance, 1);

      expect(await merkleOrchard.trees(token.address, distributor.address, 0)).to.equal(root);
      expect(await merkleOrchard.trees(token.address, distributor.address, 1)).to.equal(root2);
    });

    it('emits DistributionAdded', async () => {
      const receipt = await (
        await merkleOrchard.connect(distributor).seedAllocations(token.address, root, claimBalance, 0)
      ).wait();

      expectEvent.inReceipt(receipt, 'DistributionAdded', {
        token: token.address,
        amount: claimBalance,
      });
    });

    it("transfers the expected number of tokens to the MerkleOrchard's internal balance", async () => {
      await expectBalanceChange(
        () => merkleOrchard.connect(distributor).seedAllocations(token.address, root, claimBalance, 0),
        tokens,
        [{ account: merkleOrchard, changes: { DAI: claimBalance } }],
        vault
      );
    });

    it("increments the distribution channel's nonce", async () => {
      expect(await merkleOrchard.nextDistributionId(token.address, distributor.address)).to.be.eq(0);
      expect(await merkleOrchard.nextDistributionId(token.address, lp1.address)).to.be.eq(0);

      await merkleOrchard.connect(distributor).seedAllocations(token.address, root, claimBalance, 0);

      expect(await merkleOrchard.nextDistributionId(token.address, distributor.address)).to.be.eq(1);
      expect(await merkleOrchard.nextDistributionId(token.address, lp1.address)).to.be.eq(0);

      await merkleOrchard.connect(distributor).seedAllocations(token.address, root, claimBalance, 1);

      expect(await merkleOrchard.nextDistributionId(token.address, distributor.address)).to.be.eq(2);
      expect(await merkleOrchard.nextDistributionId(token.address, lp1.address)).to.be.eq(0);
    });

    context('when provided an invalid distribution ID', () => {
      it('reverts', async () => {
        await merkleOrchard.connect(distributor).seedAllocations(token.address, root, claimBalance, 0);
        // Here's we're providing an old ID (i.e. we've accidentally created the same distribution twice)
        await expect(
          merkleOrchard.connect(distributor).seedAllocations(token.address, root, claimBalance, 0)
        ).to.be.revertedWith('Invalid distribution ID');
      });
    });
  });

  describe('with an allocation', () => {
    const claimableBalance = bn('1000');
    let elements: string[];
    let merkleTree: MerkleTree;
    let claims: Claim[];

    sharedBeforeEach(async () => {
      elements = [encodeElement(lp1.address, claimableBalance)];
      merkleTree = new MerkleTree(elements);
      const root = merkleTree.getHexRoot();

      await merkleOrchard.connect(distributor).seedAllocations(token.address, root, claimableBalance, 0);
      const merkleProof: BytesLike[] = merkleTree.getHexProof(elements[0]);

      claims = [
        {
          distributionId: 0,
          balance: claimableBalance,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof,
        },
      ];
    });

    it('allows the user to claim a single distribution', async () => {
      await expectBalanceChange(
        () => merkleOrchard.connect(lp1).claimDistributions(lp1.address, claims, tokenAddresses),
        tokens,
        [{ account: lp1, changes: { DAI: claimableBalance } }]
      );
    });

    it('emits DistributionPaid when an allocation is claimed', async () => {
      const receipt = await (
        await merkleOrchard.connect(lp1).claimDistributions(lp1.address, claims, tokenAddresses)
      ).wait();

      expectEvent.inReceipt(receipt, 'DistributionPaid', {
        user: lp1.address,
        token: token.address,
        amount: claimableBalance,
      });
    });

    it('marks claimed distributions as claimed', async () => {
      await merkleOrchard.connect(lp1).claimDistributions(lp1.address, claims, tokenAddresses);

      const isClaimed = await merkleOrchard.claimed(token.address, distributor.address, 0, lp1.address);
      expect(isClaimed).to.equal(true); // "claim should be marked as claimed";
    });

    it('reverts when a user attempts to claim for another user', async () => {
      const errorMsg = 'user must claim own balance';
      await expect(
        merkleOrchard.connect(other).claimDistributions(lp1.address, claims, tokenAddresses)
      ).to.be.revertedWith(errorMsg);
    });

    it('reverts when the user attempts to claim the wrong balance', async () => {
      const incorrectClaimedBalance = bn('666');
      const merkleProof = merkleTree.getHexProof(elements[0]);
      const errorMsg = 'Incorrect merkle proof';

      const claimsWithIncorrectClaimableBalance = [
        {
          distributionId: 0,
          balance: incorrectClaimedBalance,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof,
        },
      ];
      await expect(
        merkleOrchard.connect(lp1).claimDistributions(lp1.address, claimsWithIncorrectClaimableBalance, tokenAddresses)
      ).to.be.revertedWith(errorMsg);
    });

    it('reverts when the user attempts to claim twice', async () => {
      await merkleOrchard.connect(lp1).claimDistributions(lp1.address, claims, tokenAddresses);

      const errorMsg = 'cannot claim twice';
      await expect(
        merkleOrchard.connect(lp1).claimDistributions(lp1.address, claims, tokenAddresses)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe('with several allocations', () => {
    const claimBalance1 = bn('1000');
    const claimBalance2 = bn('1234');

    let elements1: string[];
    let merkleTree1: MerkleTree;
    let root1: string;

    let elements2: string[];
    let merkleTree2: MerkleTree;
    let root2: string;

    sharedBeforeEach(async () => {
      elements1 = [encodeElement(lp1.address, claimBalance1)];
      merkleTree1 = new MerkleTree(elements1);
      root1 = merkleTree1.getHexRoot();

      elements2 = [encodeElement(lp1.address, claimBalance2)];
      merkleTree2 = new MerkleTree(elements2);
      root2 = merkleTree2.getHexRoot();

      await merkleOrchard.connect(distributor).seedAllocations(token.address, root1, claimBalance1, 0);

      await merkleOrchard.connect(distributor).seedAllocations(token.address, root2, claimBalance2, 1);
    });

    it('allows the user to claim multiple distributions at once', async () => {
      const claimedBalance1 = bn('1000');
      const claimedBalance2 = bn('1234');

      const proof1: BytesLike[] = merkleTree1.getHexProof(elements1[0]);
      const proof2: BytesLike[] = merkleTree2.getHexProof(elements2[0]);

      const claims: Claim[] = [
        {
          distributionId: 0,
          balance: claimedBalance1,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof1,
        },
        {
          distributionId: 1,
          balance: claimedBalance2,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof2,
        },
      ];

      await expectBalanceChange(
        () => merkleOrchard.connect(lp1).claimDistributions(lp1.address, claims, tokenAddresses),
        tokens,
        [{ account: lp1, changes: { DAI: bn('2234') } }]
      );
    });

    it('allows the user to claim multiple distributions at once to internal balance', async () => {
      const claimedBalance1 = bn('1000');
      const claimedBalance2 = bn('1234');

      const proof1: BytesLike[] = merkleTree1.getHexProof(elements1[0]);
      const proof2: BytesLike[] = merkleTree2.getHexProof(elements2[0]);

      const claims: Claim[] = [
        {
          distributionId: 0,
          balance: claimedBalance1,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof1,
        },
        {
          distributionId: 1,
          balance: claimedBalance2,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof2,
        },
      ];

      await expectBalanceChange(
        () => merkleOrchard.connect(lp1).claimDistributionsToInternalBalance(lp1.address, claims, tokenAddresses),
        tokens,
        [{ account: lp1, changes: { DAI: bn('2234') } }],
        vault
      );
    });

    it('reports distributions as unclaimed', async () => {
      const expectedResult = [false, false];
      const result = await merkleOrchard.claimStatus(lp1.address, token.address, distributor.address, 0, 1);
      expect(result).to.eql(expectedResult);
    });

    it('returns an array of merkle roots', async () => {
      const expectedResult = [root1, root2];
      const result = await merkleOrchard.merkleRoots(token.address, distributor.address, 0, 1);
      expect(result).to.eql(expectedResult); // "claim status should be accurate"
    });

    describe('with a callback', () => {
      let callbackContract: Contract;
      let claims: Claim[];

      sharedBeforeEach('set up mock callback', async () => {
        callbackContract = await deploy('MockRewardCallback');

        const proof1: BytesLike[] = merkleTree1.getHexProof(elements1[0]);
        const proof2: BytesLike[] = merkleTree2.getHexProof(elements2[0]);

        claims = [
          {
            distributionId: 0,
            balance: claimBalance1,
            distributor: distributor.address,
            tokenIndex: 0,
            merkleProof: proof1,
          },
          {
            distributionId: 1,
            balance: claimBalance2,
            distributor: distributor.address,
            tokenIndex: 0,
            merkleProof: proof2,
          },
        ];
      });

      it('allows a user to claim the reward to a callback contract', async () => {
        const expectedClaim = claimBalance1.add(claimBalance2);
        const calldata = utils.defaultAbiCoder.encode([], []);

        await expectBalanceChange(
          () =>
            merkleOrchard
              .connect(lp1)
              .claimDistributionsWithCallback(lp1.address, callbackContract.address, calldata, claims, tokenAddresses),
          tokens,
          [{ account: callbackContract.address, changes: { DAI: ['very-near', expectedClaim] } }],
          vault
        );
      });

      it('calls the callback on the contract', async () => {
        const calldata = utils.defaultAbiCoder.encode([], []);

        const receipt = await (
          await merkleOrchard
            .connect(lp1)
            .claimDistributionsWithCallback(lp1.address, callbackContract.address, calldata, claims, tokenAddresses)
        ).wait();

        expectEvent.inIndirectReceipt(receipt, callbackContract.interface, 'CallbackReceived', {});
      });
    });

    describe('When a user has claimed one of their allocations', async () => {
      sharedBeforeEach(async () => {
        const claimedBalance1 = bn('1000');
        const proof1 = merkleTree1.getHexProof(elements1[0]);

        const claims: Claim[] = [
          {
            distributionId: 0,
            balance: claimedBalance1,
            distributor: distributor.address,
            tokenIndex: 0,
            merkleProof: proof1,
          },
        ];

        await merkleOrchard.connect(lp1).claimDistributions(lp1.address, claims, tokenAddresses);
      });

      it('reports one of the distributions as claimed', async () => {
        const expectedResult = [true, false];
        const result = await merkleOrchard.claimStatus(lp1.address, token.address, distributor.address, 0, 1);
        expect(result).to.eql(expectedResult);
      });
    });
  });
});
