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

import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MerkleTree } from '../lib/merkleTree';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

function encodeElement(address: string, balance: BigNumber): string {
  return ethers.utils.solidityKeccak256(['address', 'uint'], [address, balance]);
}

interface Claim {
  distributionId: BigNumber;
  balance: BigNumber;
  distributor: string;
  tokenIndex: number;
  merkleProof: BytesLike[];
}

describe('MerkleOrchard', () => {
  let tokens: TokenList,
    token1: Token,
    token2: Token,
    vault: Contract,
    merkleOrchard: Contract,
    tokenAddresses: string[];

  let admin: SignerWithAddress,
    distributor: SignerWithAddress,
    claimer1: SignerWithAddress,
    claimer2: SignerWithAddress,
    other: SignerWithAddress;
  const tokenInitialBalance = bn(100e18);
  const claimBalance = bn('9876');

  before('setup', async () => {
    [, admin, distributor, claimer1, claimer2, other] = await ethers.getSigners();
  });

  sharedBeforeEach('deploy vault and tokens', async () => {
    const vaultHelper = await Vault.create({ admin });
    vault = vaultHelper.instance;

    tokens = await TokenList.create(['DAI', 'BAT'], { sorted: true });
    token1 = tokens.DAI;
    token2 = tokens.BAT;
    tokenAddresses = [token1.address, token2.address];

    merkleOrchard = await deploy('MerkleOrchard', {
      args: [vault.address],
      from: admin,
    });
    await tokens.mint({ to: distributor.address, amount: tokenInitialBalance });
    await tokens.approve({ to: merkleOrchard.address, from: [distributor] });
  });

  it('stores an allocation', async () => {
    const elements = [encodeElement(claimer1.address, claimBalance)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();

    await merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, bn(1));

    const proof = merkleTree.getHexProof(elements[0]);

    const result = await merkleOrchard.verifyClaim(
      token1.address,
      distributor.address,
      1,
      claimer1.address,
      claimBalance,
      proof
    );
    expect(result).to.equal(true);
  });

  it('emits DistributionAdded when an allocation is stored', async () => {
    const elements = [encodeElement(claimer1.address, claimBalance)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();

    const receipt = await (
      await merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, bn(1))
    ).wait();

    expectEvent.inReceipt(receipt, 'DistributionAdded', {
      token: token1.address,
      distributor: distributor.address,
      merkleRoot: root,
      amount: claimBalance,
    });
  });

  it('requisitions tokens when it stores a balance', async () => {
    const elements = [encodeElement(claimer1.address, claimBalance)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();

    await expectBalanceChange(
      () => merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, bn(1)),
      tokens,
      [{ account: merkleOrchard, changes: { DAI: claimBalance } }],
      vault
    );
  });

  it("increments the distribution channel's distributionId", async () => {
    const elements = [encodeElement(claimer1.address, claimBalance)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();

    expect(await merkleOrchard.getNextDistributionId(token1.address, distributor.address)).to.be.eq(0);
    expect(await merkleOrchard.getNextDistributionId(token1.address, claimer1.address)).to.be.eq(0);

    await merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, 0);

    expect(await merkleOrchard.getNextDistributionId(token1.address, distributor.address)).to.be.eq(1);
    expect(await merkleOrchard.getNextDistributionId(token1.address, claimer1.address)).to.be.eq(0);

    await merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, 1);

    expect(await merkleOrchard.getNextDistributionId(token1.address, distributor.address)).to.be.eq(2);
    expect(await merkleOrchard.getNextDistributionId(token1.address, claimer1.address)).to.be.eq(0);
  });

  it('allows the distribution id to have an offset', async () => {
    const elements = [encodeElement(claimer1.address, claimBalance)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();
    await merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, 72);
    expect(await merkleOrchard.getNextDistributionId(token1.address, distributor.address)).to.be.eq(73);
    await merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, 73);
    expect(await merkleOrchard.getNextDistributionId(token1.address, distributor.address)).to.be.eq(74);
  });

  context('when provided an invalid distribution ID', () => {
    it('reverts', async () => {
      const elements = [encodeElement(claimer1.address, claimBalance)];
      const merkleTree = new MerkleTree(elements);
      const root = merkleTree.getHexRoot();
      await merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, 0);
      // Here's we're providing an old ID (i.e. we've accidentally created the same distribution twice)
      await expect(
        merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimBalance, 0)
      ).to.be.revertedWith('invalid distribution ID');
    });
  });

  it('stores multiple allocations', async () => {
    const claimBalance0 = bn('1000');
    const claimBalance1 = bn('2000');

    const elements = [encodeElement(claimer1.address, claimBalance0), encodeElement(claimer2.address, claimBalance1)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();

    await merkleOrchard.connect(distributor).createDistribution(token1.address, root, bn('3000'), 1);

    const proof0 = merkleTree.getHexProof(elements[0]);
    let result = await merkleOrchard.verifyClaim(
      token1.address,
      distributor.address,
      1,
      claimer1.address,
      claimBalance0,
      proof0
    );
    expect(result).to.equal(true); //"account 0 should have an allocation";

    const proof1 = merkleTree.getHexProof(elements[1]);
    result = await merkleOrchard.verifyClaim(
      token1.address,
      distributor.address,
      1,
      claimer2.address,
      claimBalance1,
      proof1
    );
    expect(result).to.equal(true); // "account 1 should have an allocation";
  });

  describe('with an allocation', () => {
    const claimableBalance = bn('1000');
    let elements: string[];
    let merkleTree: MerkleTree;
    let claims: Claim[];

    sharedBeforeEach(async () => {
      elements = [encodeElement(claimer1.address, claimableBalance)];
      merkleTree = new MerkleTree(elements);
      const root = merkleTree.getHexRoot();

      await merkleOrchard.connect(distributor).createDistribution(token1.address, root, claimableBalance, 1);
      const merkleProof: BytesLike[] = merkleTree.getHexProof(elements[0]);

      claims = [
        {
          distributionId: bn(1),
          balance: claimableBalance,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof,
        },
      ];
    });

    it('allows the user to claim a single distribution', async () => {
      await expectBalanceChange(
        () => merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses),
        tokens,
        [{ account: claimer1, changes: { DAI: claimableBalance } }]
      );
    });

    it('emits DistributionClaimed when an allocation is claimed', async () => {
      const receipt = await (
        await merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses)
      ).wait();

      expectEvent.inReceipt(receipt, 'DistributionClaimed', {
        claimer: claimer1.address,
        recipient: claimer1.address,
        token: token1.address,
        distributor: distributor.address,
        amount: claimableBalance,
      });
    });

    it('marks claimed distributions as claimed', async () => {
      await merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses);

      const isClaimed = await merkleOrchard.isClaimed(token1.address, distributor.address, 1, claimer1.address);
      expect(isClaimed).to.equal(true); // "claim should be marked as claimed";
    });

    it('allows anyone to claim for another user', async () => {
      await expectBalanceChange(
        () => merkleOrchard.connect(other).claimDistributions(claimer1.address, claims, tokenAddresses),
        tokens,
        [{ account: claimer1, changes: { DAI: claimableBalance } }]
      );
    });

    it('reverts when a user attempts to claim to internal balance for another user', async () => {
      const errorMsg = 'user must claim own balance';
      await expect(
        merkleOrchard.connect(other).claimDistributionsToInternalBalance(claimer1.address, claims, tokenAddresses)
      ).to.be.revertedWith(errorMsg);
    });

    it('reverts when the user attempts to claim the wrong balance', async () => {
      const incorrectClaimedBalance = bn('666');
      const merkleProof = merkleTree.getHexProof(elements[0]);
      const errorMsg = 'incorrect merkle proof';

      const claimsWithIncorrectClaimableBalance = [
        {
          distributionId: 1,
          balance: incorrectClaimedBalance,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof,
        },
      ];
      await expect(
        merkleOrchard
          .connect(claimer1)
          .claimDistributions(claimer1.address, claimsWithIncorrectClaimableBalance, tokenAddresses)
      ).to.be.revertedWith(errorMsg);
    });

    it('reverts when the user attempts to claim twice', async () => {
      await merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses);

      const errorMsg = 'cannot claim twice';
      await expect(
        merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses)
      ).to.be.revertedWith(errorMsg);
    });

    it('reverts when an admin attempts to overwrite an allocationn', async () => {
      const elements2 = [
        encodeElement(claimer1.address, claimableBalance),
        encodeElement(claimer2.address, claimableBalance),
      ];
      const merkleTree2 = new MerkleTree(elements2);
      const root2 = merkleTree2.getHexRoot();

      const errorMsg = 'invalid distribution ID';
      expect(
        merkleOrchard.connect(admin).createDistribution(token1.address, root2, claimableBalance.mul(2), 1)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe('with several allocations in the same channel', () => {
    const claimBalance1 = bn('1000');
    const claimBalance2 = bn('1234');

    let elements1: string[];
    let merkleTree1: MerkleTree;
    let root1: string;

    let elements2: string[];
    let merkleTree2: MerkleTree;
    let root2: string;

    sharedBeforeEach(async () => {
      elements1 = [encodeElement(claimer1.address, claimBalance1)];
      merkleTree1 = new MerkleTree(elements1);
      root1 = merkleTree1.getHexRoot();

      elements2 = [encodeElement(claimer1.address, claimBalance2)];
      merkleTree2 = new MerkleTree(elements2);
      root2 = merkleTree2.getHexRoot();

      await merkleOrchard.connect(distributor).createDistribution(token1.address, root1, claimBalance1, bn(1));

      await merkleOrchard.connect(distributor).createDistribution(token1.address, root2, claimBalance2, bn(2));
    });

    it('allows the user to claim multiple distributions at once', async () => {
      const claimedBalance1 = bn('1000');
      const claimedBalance2 = bn('1234');

      const proof1: BytesLike[] = merkleTree1.getHexProof(elements1[0]);
      const proof2: BytesLike[] = merkleTree2.getHexProof(elements2[0]);

      const claims: Claim[] = [
        {
          distributionId: bn(1),
          balance: claimedBalance1,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof1,
        },
        {
          distributionId: bn(2),
          balance: claimedBalance2,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof2,
        },
      ];

      await expectBalanceChange(
        () => merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses),
        tokens,
        [{ account: claimer1, changes: { DAI: bn('2234') } }]
      );
    });

    it('allows the user to claim multiple distributions at once to internal balance', async () => {
      const claimedBalance1 = bn('1000');
      const claimedBalance2 = bn('1234');

      const proof1: BytesLike[] = merkleTree1.getHexProof(elements1[0]);
      const proof2: BytesLike[] = merkleTree2.getHexProof(elements2[0]);

      const claims: Claim[] = [
        {
          distributionId: bn(1),
          balance: claimedBalance1,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof1,
        },
        {
          distributionId: bn(2),
          balance: claimedBalance2,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof2,
        },
      ];

      await expectBalanceChange(
        () =>
          merkleOrchard.connect(claimer1).claimDistributionsToInternalBalance(claimer1.address, claims, tokenAddresses),
        tokens,
        [{ account: claimer1, changes: { DAI: bn('2234') } }],
        vault
      );
    });

    it('reports distributions as unclaimed', async () => {
      expect(await merkleOrchard.isClaimed(token1.address, distributor.address, 1, claimer1.address)).to.eql(false);
      expect(await merkleOrchard.isClaimed(token1.address, distributor.address, 2, claimer1.address)).to.eql(false);
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
            distributionId: bn(1),
            balance: claimBalance1,
            distributor: distributor.address,
            tokenIndex: 0,
            merkleProof: proof1,
          },
          {
            distributionId: bn(2),
            balance: claimBalance2,
            distributor: distributor.address,
            tokenIndex: 0,
            merkleProof: proof2,
          },
        ];
      });

      it('allows a user to claim the tokens to a callback contract', async () => {
        const expectedClaim = claimBalance1.add(claimBalance2);
        const calldata = utils.defaultAbiCoder.encode([], []);

        await expectBalanceChange(
          () =>
            merkleOrchard
              .connect(claimer1)
              .claimDistributionsWithCallback(
                claimer1.address,
                claims,
                tokenAddresses,
                callbackContract.address,
                calldata
              ),
          tokens,
          [{ account: callbackContract.address, changes: { DAI: ['very-near', expectedClaim] } }],
          vault
        );
      });

      it('calls the callback on the contract', async () => {
        const calldata = utils.defaultAbiCoder.encode([], []);

        const receipt = await (
          await merkleOrchard
            .connect(claimer1)
            .claimDistributionsWithCallback(
              claimer1.address,
              claims,
              tokenAddresses,
              callbackContract.address,
              calldata
            )
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
            distributionId: bn(1),
            balance: claimedBalance1,
            distributor: distributor.address,
            tokenIndex: 0,
            merkleProof: proof1,
          },
        ];

        await merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses);
      });

      it('reports one of the distributions as claimed', async () => {
        expect(await merkleOrchard.isClaimed(token1.address, distributor.address, 1, claimer1.address)).to.eql(true);
        expect(await merkleOrchard.isClaimed(token1.address, distributor.address, 2, claimer1.address)).to.eql(false);
      });
    });
  });

  describe('with allocations in the same channel, crossing claim storage slots', () => {
    const claimBalance1 = bn('1000');
    const claimBalance2 = bn('1234');

    let elements1: string[];
    let merkleTree1: MerkleTree;
    let root1: string;

    let elements2: string[];
    let merkleTree2: MerkleTree;
    let root2: string;

    let proof1: BytesLike[];
    let proof2: BytesLike[];
    let claims: Claim[];

    sharedBeforeEach(async () => {
      elements1 = [encodeElement(claimer1.address, claimBalance1)];
      merkleTree1 = new MerkleTree(elements1);
      root1 = merkleTree1.getHexRoot();
      proof1 = merkleTree1.getHexProof(elements1[0]);

      elements2 = [encodeElement(claimer1.address, claimBalance2)];
      merkleTree2 = new MerkleTree(elements2);
      root2 = merkleTree2.getHexRoot();
      proof2 = merkleTree2.getHexProof(elements2[0]);

      // very end of one claim storage slot
      await merkleOrchard.connect(distributor).createDistribution(token1.address, root1, claimBalance1, bn(255));
      // very beginning of the next claim storage slot
      await merkleOrchard.connect(distributor).createDistribution(token1.address, root2, claimBalance2, bn(256));

      claims = [
        {
          distributionId: bn(255),
          balance: claimBalance1,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof1,
        },
        {
          distributionId: bn(256),
          balance: claimBalance2,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof2,
        },
      ];
    });

    it('allows the user to claim multiple distributions at once', async () => {
      await expectBalanceChange(
        () => merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses),
        tokens,
        [{ account: claimer1, changes: { DAI: bn('2234') } }]
      );
    });

    it('marks distributions as claimed', async () => {
      await merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses);
      expect(await merkleOrchard.isClaimed(token1.address, distributor.address, 254, claimer1.address)).to.eql(false);
      expect(await merkleOrchard.isClaimed(token1.address, distributor.address, 255, claimer1.address)).to.eql(true);
      expect(await merkleOrchard.isClaimed(token1.address, distributor.address, 256, claimer1.address)).to.eql(true);
      expect(await merkleOrchard.isClaimed(token1.address, distributor.address, 257, claimer1.address)).to.eql(false);
    });
  });

  describe('with several allocations accross multiple channels', () => {
    const claimBalance1 = bn('1000');
    const claimBalance2 = bn('1234');

    let elements1: string[];
    let merkleTree1: MerkleTree;
    let root1: string;

    let elements2: string[];
    let merkleTree2: MerkleTree;
    let root2: string;

    sharedBeforeEach(async () => {
      elements1 = [encodeElement(claimer1.address, claimBalance1)];
      merkleTree1 = new MerkleTree(elements1);
      root1 = merkleTree1.getHexRoot();

      elements2 = [encodeElement(claimer1.address, claimBalance2)];
      merkleTree2 = new MerkleTree(elements2);
      root2 = merkleTree2.getHexRoot();

      await merkleOrchard.connect(distributor).createDistribution(token1.address, root1, claimBalance1, bn(1));

      await merkleOrchard.connect(distributor).createDistribution(token2.address, root2, claimBalance2, bn(2));
    });

    it('allows the user to claim multiple distributions at once', async () => {
      const claimedBalance1 = bn('1000');
      const claimedBalance2 = bn('1234');

      const proof1: BytesLike[] = merkleTree1.getHexProof(elements1[0]);
      const proof2: BytesLike[] = merkleTree2.getHexProof(elements2[0]);

      const claims: Claim[] = [
        {
          distributionId: bn(1),
          balance: claimedBalance1,
          distributor: distributor.address,
          tokenIndex: 0,
          merkleProof: proof1,
        },
        {
          distributionId: bn(2),
          balance: claimedBalance2,
          distributor: distributor.address,
          tokenIndex: 1,
          merkleProof: proof2,
        },
      ];

      await expectBalanceChange(
        () => merkleOrchard.connect(claimer1).claimDistributions(claimer1.address, claims, tokenAddresses),
        tokens,
        [{ account: claimer1, changes: { DAI: bn('1000'), BAT: bn('1234') } }]
      );
    });
  });
});
