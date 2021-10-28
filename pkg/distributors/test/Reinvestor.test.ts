import { ethers } from 'hardhat';
import { BytesLike, BigNumber } from 'ethers';
import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { MerkleTree } from '../lib/merkleTree';

import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';

import { bn, fp } from '@balancer-labs/v2-helpers/src/numbers';
import { MAX_UINT256, ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

import { AssetHelpers, WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import * as expectEvent from '@balancer-labs/v2-helpers/src/test/expectEvent';
import { expectBalanceChange } from '@balancer-labs/v2-helpers/src/test/tokenBalance';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { setup, tokenInitialBalance } from './MultiDistributorSharedSetup';

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

describe('Reinvestor', () => {
  let vault: Vault;
  let callbackContract: Contract;
  let pool: Contract;
  let tokens: TokenList,
    token1: Token,
    token2: Token,
    orchard: Contract,
    tokenAddresses: string[];
  let admin: SignerWithAddress,
    distributor: SignerWithAddress,
    claimer1: SignerWithAddress,
    claimer2: SignerWithAddress,
    other: SignerWithAddress;

  const claimBalance = fp(1);

  before('deploy base contracts', async () => {
    [, admin, distributor, claimer1, claimer2, other] = await ethers.getSigners();
  });

  sharedBeforeEach('set up asset manager and reinvestor', async () => {
    const { contracts } = await setup();

    pool = contracts.pool;
    vault = contracts.vault;

    callbackContract = await deploy('Reinvestor', { args: [vault.address] });

    tokens = await TokenList.create(['DAI', 'BAT'], { sorted: true });
    token1 = tokens.DAI;
    token2 = tokens.BAT;
    tokenAddresses = [token1.address, token2.address];

    orchard = await deploy('MerkleOrchard', {
      args: [vault.address],
      from: admin,
    });
    await tokens.mint({ to: distributor.address, amount: tokenInitialBalance });
    await tokens.approve({ to: orchard.address, from: [distributor] });

  });

  describe('with a distribution', () => {
    sharedBeforeEach(async () => {

      const elements = [encodeElement(claimer1.address, claimBalance)];
      const merkleTree = new MerkleTree(elements);
      const root = merkleTree.getHexRoot();
      await orchard.connect(distributor).createDistribution(token1.address, root, claimBalance, bn(1));

    });

    describe('with a pool to claim into', () => {
      let destinationPool: Contract;
      let destinationPoolId: string;
      let assets: string[];
      let claims: Claim[];

      sharedBeforeEach(async () => {
        const elements = [encodeElement(claimer1.address, claimBalance)];
        const merkleTree = new MerkleTree(elements);
        const root = merkleTree.getHexRoot();

        const merkleProof: BytesLike[] = merkleTree.getHexProof(elements[0]);

        claims = [
          {
            distributionId: bn(1),
            balance: claimBalance,
            distributor: distributor.address,
            tokenIndex: 0,
            merkleProof,
          },
        ];

        // Creating a BAT-DAI pool
        await tokens.mint({ to: claimer1, amount: tokenInitialBalance });
        await tokens.approve({ to: vault.address, from: [claimer1] });

        [assets] = new AssetHelpers(ZERO_ADDRESS).sortTokens([token1.address, tokens.BAT.address]);
        const weights = [fp(0.5), fp(0.5)];
        const assetManagers = [ZERO_ADDRESS, ZERO_ADDRESS];

        destinationPool = await deploy('v2-pool-weighted/WeightedPool', {
          args: [
            vault.address,
            'Reinvestment Pool',
            'REINVEST',
            assets,
            weights,
            assetManagers,
            fp(0.0001),
            0,
            0,
            admin.address,
          ],
        });

        destinationPoolId = await destinationPool.getPoolId();

        await vault.instance.connect(claimer1).joinPool(destinationPoolId, claimer1.address, claimer1.address, {
          assets,
          maxAmountsIn: Array(assets.length).fill(MAX_UINT256),
          fromInternalBalance: false,
          userData: WeightedPoolEncoder.joinInit(Array(assets.length).fill(tokenInitialBalance)),
        });
      });

      it('emits PoolBalanceChanged when a LP claims to weighted pool', async () => {
        const args = [claimer1.address, destinationPoolId, [token1.address]];
        const calldata = utils.defaultAbiCoder.encode(['(address,bytes32,address[])'], [args]);

        const receipt = await (
          await orchard.connect(claimer1).claimDistributionsWithCallback(claimer1.address, claims, tokenAddresses, callbackContract.address, calldata)
        ).wait();

        const deltas = [bn(0), bn(0)];
        deltas[assets.indexOf(token1.address)] = claimBalance;
        expectEvent.inIndirectReceipt(receipt, vault.interface, 'PoolBalanceChanged', {
          poolId: destinationPoolId,
          liquidityProvider: callbackContract.address,
          tokens: assets,
          deltas,
          protocolFeeAmounts: [0, 0],
        });
      });

      it('mints bpt to a LP when they claim to weighted pool', async () => {
        const bptBalanceBefore = await destinationPool.balanceOf(claimer1.address);
        const args = [claimer1.address, destinationPoolId, [token1.address]];
        const calldata = utils.defaultAbiCoder.encode(['(address,bytes32,address[])'], [args]);

        await orchard.connect(claimer1).claimDistributionsWithCallback(claimer1.address, claims, tokenAddresses, callbackContract.address, calldata);
        const bptBalanceAfter = await destinationPool.balanceOf(claimer1.address);
        expect(bptBalanceAfter.sub(bptBalanceBefore)).to.be.equalWithError(fp('1'), 2e-3);
      });

      describe('createDistribution', () => {
        let anotherId: string;
        let otherTokens: TokenList;
        let otherToken: Token;
        let allTokenAddresses: string[];

        sharedBeforeEach('with multiple tokens', async () => {
          otherTokens = await TokenList.create(['GRT'], { sorted: true });
          otherToken = otherTokens.GRT;

          allTokenAddresses = [token1.address, token2.address, otherToken.address];

          await otherTokens.mint({ to: distributor, amount: bn(100e18) });
          await otherTokens.approve({ to: orchard.address, from: [distributor] });

          const elements = [encodeElement(claimer1.address, claimBalance)];
          const merkleTree = new MerkleTree(elements);
          const root = merkleTree.getHexRoot();

          await orchard.connect(distributor).createDistribution(otherToken.address, root, claimBalance, bn(1));

          const merkleProof: BytesLike[] = merkleTree.getHexProof(elements[0]);

          claims = [
            {
              distributionId: bn(1),
              balance: claimBalance,
              distributor: distributor.address,
              tokenIndex: 0,
              merkleProof,
            },
            {
              distributionId: bn(1),
              balance: claimBalance,
              distributor: distributor.address,
              tokenIndex: 2,
              merkleProof,
            },
          ];
        });

        it('returns tokens that are unused in reinvestment', async () => {
          const token1Addresses = [token1.address, otherToken.address];
          const args = [claimer1.address, destinationPoolId, token1Addresses];
          const calldata = utils.defaultAbiCoder.encode(['(address,bytes32,address[])'], [args]);

          await expectBalanceChange(
            () => orchard.connect(claimer1).claimDistributionsWithCallback(claimer1.address, claims, allTokenAddresses, callbackContract.address, calldata),
            otherTokens,
            [{ account: claimer1, changes: { GRT: ['very-near', claimBalance] } }]
          );
        });
      });
    });
  });
});
