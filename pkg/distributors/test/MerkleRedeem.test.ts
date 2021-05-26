import { ethers } from 'hardhat';
import { BytesLike, BigNumber } from 'ethers';
import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { GeneralPool } from '@balancer-labs/v2-helpers/src/models/vault/pools';
import { encodeJoin } from '@balancer-labs/v2-helpers/src/models/pools/mockPool';

import { bn } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256 } from '@balancer-labs/v2-helpers/src/constants';
import { MerkleTree } from '../lib/merkleTree';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

function encodeElement(address: string, balance: BigNumber): string {
  return ethers.utils.solidityKeccak256(['address', 'uint'], [address, balance]);
}

describe('MerkleRedeem', () => {
  let tokens: TokenList,
    rewardTokens: TokenList,
    rewardToken: Token,
    vault: Contract,
    authorizer: Contract,
    merkleRedeem: Contract;

  let admin: SignerWithAddress,
    lp1: SignerWithAddress,
    lp2: SignerWithAddress,
    lp3: SignerWithAddress,
    mockAssetManager: SignerWithAddress;
  let poolId: string;
  const rewardTokenInitialBalance = bn(100e18);
  const tokenInitialBalance = bn(200e18);

  before('deploy base contracts', async () => {
    [admin, lp1, lp2, lp3, mockAssetManager] = await ethers.getSigners();
  });

  beforeEach('set up tokens and redeem contract', async () => {
    tokens = await TokenList.create(['SNX', 'MKR'], { sorted: true });

    rewardTokens = await TokenList.create(['DAI'], { sorted: true });
    rewardToken = rewardTokens.DAI;

    // Deploy Balancer Vault
    authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });
    vault = await deploy('v2-vault/Vault', { args: [authorizer.address, tokens.SNX.address, 0, 0] });

    merkleRedeem = await deploy('MerkleRedeem', {
      args: [vault.address, rewardToken.address],
    });
    await rewardTokens.mint({ to: merkleRedeem.address, amount: rewardTokenInitialBalance });

    // deploy pool and add liquidity
    const specialization = GeneralPool;
    const pool = await deploy('v2-vault/MockPool', { args: [vault.address, specialization] });
    poolId = await pool.getPoolId();

    await tokens.mint({ to: lp1, amount: tokenInitialBalance });
    await tokens.approve({ to: vault.address, from: [lp1] });

    const assets = tokens.addresses;
    const assetManagers = [mockAssetManager.address, mockAssetManager.address];
    await pool.registerTokens(assets, assetManagers);

    await vault.connect(lp1).joinPool(poolId, lp1.address, lp2.address, {
      assets,
      maxAmountsIn: assets.map(() => MAX_UINT256),
      fromInternalBalance: false,
      userData: encodeJoin(
        assets.map(() => tokenInitialBalance),
        assets.map(() => 0)
      ),
    });
  });

  it('stores an allocation', async () => {
    const claimBalance = bn('9876');

    const elements = [encodeElement(lp1.address, claimBalance)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();

    await merkleRedeem.connect(admin).seedAllocations(bn(1), root);

    const proof = merkleTree.getHexProof(elements[0]);

    const result = await merkleRedeem.verifyClaim(lp1.address, 1, claimBalance, proof);
    expect(result).to.equal(true);
  });

  it("doesn't allow an allocation to be overwritten", async () => {
    const claimBalance = bn('9876');

    const elements = [encodeElement(lp1.address, claimBalance)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();

    await merkleRedeem.seedAllocations(1, root);

    // construct tree to attempt to override the allocation
    const elements2 = [encodeElement(lp1.address, claimBalance), encodeElement(lp2.address, claimBalance)];
    const merkleTree2 = new MerkleTree(elements2);
    const root2 = merkleTree2.getHexRoot();

    const errorMsg = 'cannot rewrite merkle root';
    expect(merkleRedeem.seedAllocations(1, root2)).to.be.revertedWith(errorMsg);
  });

  it('stores multiple allocations', async () => {
    const claimBalance0 = bn('1000');
    const claimBalance1 = bn('2000');

    const elements = [encodeElement(lp1.address, claimBalance0), encodeElement(lp2.address, claimBalance1)];
    const merkleTree = new MerkleTree(elements);
    const root = merkleTree.getHexRoot();

    await merkleRedeem.seedAllocations(1, root);

    const proof0 = merkleTree.getHexProof(elements[0]);
    let result = await merkleRedeem.verifyClaim(lp1.address, 1, claimBalance0, proof0);
    expect(result).to.equal(true); //"account 0 should have an allocation";

    const proof1 = merkleTree.getHexProof(elements[1]);
    result = await merkleRedeem.verifyClaim(lp2.address, 1, claimBalance1, proof1);
    expect(result).to.equal(true); // "account 1 should have an allocation";
  });

  describe('When a user has an allocation to claim', () => {
    const claimBalance = bn('1000');
    let elements: string[];
    let merkleTree: MerkleTree;

    beforeEach(async () => {
      elements = [encodeElement(lp2.address, claimBalance)];
      merkleTree = new MerkleTree(elements);
      const root = merkleTree.getHexRoot();

      await merkleRedeem.seedAllocations(1, root);
    });

    it('Allows the user to claimWeek', async () => {
      const claimedBalance = bn('1000');
      const merkleProof: BytesLike[] = merkleTree.getHexProof(elements[0]);
      await merkleRedeem.connect(lp2).claimWeek(lp2.address, 1, claimedBalance, merkleProof, false);

      const result = await rewardToken.balanceOf(lp2.address);
      expect(result).to.equal(claimedBalance); //"user should have an allocation";

      const isClaimed = await merkleRedeem.claimed(1, lp2.address);
      expect(isClaimed).to.equal(true); // "claim should be marked as claimed";
    });

    it('Allows the user to claimWeek to internal balance', async () => {
      const claimedBalance = bn('1000');
      const merkleProof: BytesLike[] = merkleTree.getHexProof(elements[0]);

      await expectBalanceChange(
        () => merkleRedeem.connect(lp2).claimWeek(lp2.address, 1, claimedBalance, merkleProof, true),
        rewardTokens,
        [{ account: lp2, changes: { DAI: claimedBalance } }],
        vault
      );

      const isClaimed = await merkleRedeem.claimed(1, lp2.address);
      expect(isClaimed).to.equal(true); // "claim should be marked as claimed";
    });

    it("Doesn't allow a user to claim for another user", async () => {
      const claimedBalance = bn('1000');
      const merkleProof = merkleTree.getHexProof(elements[0]);

      const errorMsg = 'Incorrect merkle proof';
      expect(
        merkleRedeem.connect(lp3).claimWeek(lp3.address, 1, claimedBalance, merkleProof, false)
      ).to.be.revertedWith(errorMsg);
    });

    it('Reverts when the user attempts to claim the wrong balance', async () => {
      const claimedBalance = bn('666');
      const merkleProof = merkleTree.getHexProof(elements[0]);
      const errorMsg = 'Incorrect merkle proof';
      expect(
        merkleRedeem.connect(lp2).claimWeek(lp2.address, 1, claimedBalance, merkleProof, false)
      ).to.be.revertedWith(errorMsg);
    });

    it('Reverts when the user attempts to claim twice', async () => {
      const claimedBalance = bn('1000');
      const merkleProof = merkleTree.getHexProof(elements[0]);

      await merkleRedeem.connect(lp2).claimWeek(lp2.address, 1, claimedBalance, merkleProof, false);

      const errorMsg = 'cannot claim twice';
      expect(
        merkleRedeem.connect(lp2).claimWeek(lp2.address, 1, claimedBalance, merkleProof, false)
      ).to.be.revertedWith(errorMsg);
    });
  });

  describe('When a user has several allocation to claim', () => {
    const claimBalance1 = bn('1000');
    const claimBalance2 = bn('1234');

    let elements1: string[];
    let merkleTree1: MerkleTree;
    let root1: string;

    let elements2: string[];
    let merkleTree2: MerkleTree;
    let root2: string;

    beforeEach(async () => {
      elements1 = [encodeElement(lp2.address, claimBalance1)];
      merkleTree1 = new MerkleTree(elements1);
      root1 = merkleTree1.getHexRoot();

      elements2 = [encodeElement(lp2.address, claimBalance2)];
      merkleTree2 = new MerkleTree(elements2);
      root2 = merkleTree2.getHexRoot();

      await merkleRedeem.seedAllocations(bn(1), root1);

      await merkleRedeem.seedAllocations(bn(2), root2);
    });

    it('Allows the user to claim multiple weeks at once', async () => {
      const claimedBalance1 = bn('1000');
      const claimedBalance2 = bn('1234');

      const proof1: BytesLike[] = merkleTree1.getHexProof(elements1[0]);
      const proof2: BytesLike[] = merkleTree2.getHexProof(elements2[0]);

      const merkleProofs = [
        { week: bn(1), balance: claimedBalance1, merkleProof: proof1 },
        { week: bn(2), balance: claimedBalance2, merkleProof: proof2 },
      ];

      await merkleRedeem.connect(lp2).claimWeeks(lp2.address, merkleProofs, false);

      const result = await rewardToken.balanceOf(lp2.address);
      expect(result).to.equal(bn('2234')); //"user should receive all tokens, including current week"
    });

    it('Returns an array of week claims', async () => {
      let expectedResult = [false, false];
      let result = await merkleRedeem.claimStatus(lp2.address, 1, 2);
      expect(result).to.eql(expectedResult); // "claim status should be accurate"
      const claimedBalance1 = bn('1000');
      const proof1 = merkleTree1.getHexProof(elements1[0]);

      const merkleProofs = [{ week: bn(1), balance: claimedBalance1, merkleProof: proof1 }];

      await merkleRedeem.connect(lp2).claimWeeks(lp2.address, merkleProofs, false);

      expectedResult = [true, false];
      result = await merkleRedeem.claimStatus(lp2.address, 1, 2);
      expect(result).to.eql(expectedResult); // "claim status should be accurate"
    });

    it('Returns an array of merkle roots', async () => {
      const expectedResult = [root1, root2];
      const result = await merkleRedeem.merkleRoots(1, 2);
      expect(result).to.eql(expectedResult); // "claim status should be accurate"
    });
  });
});
