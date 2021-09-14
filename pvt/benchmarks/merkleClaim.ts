import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { TokenList } from '@balancer-labs/v2-helpers/src/tokens';
import { setupEnvironment } from './misc';
import { BigNumberish, printGas } from '@balancer-labs/v2-helpers/src/numbers';
import { BytesLike, solidityKeccak256 } from 'ethers/lib/utils';
import { MerkleTree } from '@balancer-labs/v2-distributors/lib/merkleTree';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ethers } from 'hardhat';

interface Claim {
  rewardToken: string;
  rewarder: string;
  distribution: BigNumberish;
  index: BigNumberish;
  balance: BigNumberish;
  merkleProof: BytesLike[];
}

let vault: Contract;
let tokens: TokenList;
let rewarder: SignerWithAddress;
let claimer: SignerWithAddress;

async function main() {
  ({ vault, tokens, trader: rewarder } = await setupEnvironment());
  [, claimer] = await ethers.getSigners();

  for (let i = 1; i <= 5; i++) {
    console.log(`\n# Claiming ${i} distributions`);

    await claimDistributions(i, false);
    await claimDistributions(i, true);
  }
}

async function claimDistributions(numberOfDistributions: number, useInternalBalance: boolean) {
  console.log(`\n## ${useInternalBalance ? 'Using Internal Balance' : 'Sending and receiving tokens'}`);

  const merkleOrchard = await deploy('v2-distributors/MerkleOrchard', { args: [vault.address] });

  const rewardToken = Object.values(tokens)[0];
  const rewardAmount = BigNumber.from(100);
  const merkleLeaves = [
    solidityKeccak256(['uint256', 'address', 'uint256'], [0, rewarder.address, rewardAmount]),
    solidityKeccak256(['uint256', 'address', 'uint256'], [1, claimer.address, rewardAmount]),
  ];

  await prepareMerkleOrchard(merkleOrchard, rewardToken, numberOfDistributions, merkleLeaves, rewardAmount);

  // The claimer now benefits from being able to reuse the same storage slots
  const claims: Claim[] = Array.from({ length: numberOfDistributions }, (_, distribution) => ({
    rewardToken: rewardToken.address,
    rewarder: rewarder.address,
    distribution,
    index: 1,
    balance: rewardAmount,
    merkleProof: [merkleLeaves[0]],
  }));

  let receipt;
  if (useInternalBalance) {
    receipt = await (
      await merkleOrchard.connect(claimer).claimDistributionsToInternalBalance(claimer.address, claims)
    ).wait();
  } else {
    receipt = await (await merkleOrchard.connect(claimer).claimDistributions(claimer.address, claims)).wait();
  }

  console.log(
    `${numberOfDistributions} claims: ${printGas(receipt.gasUsed)} (${printGas(
      receipt.gasUsed / numberOfDistributions
    )} per claim)`
  );
}

async function prepareMerkleOrchard(
  merkleOrchard: Contract,
  rewardToken: Contract,
  numberOfDistributions: number,
  merkleLeaves: string[],
  rewardAmount: BigNumber
) {
  const merkleTree = new MerkleTree(merkleLeaves);
  const merkleRoot = merkleTree.getHexRoot();

  await rewardToken.connect(rewarder).approve(merkleOrchard.address, rewardAmount.mul(numberOfDistributions).mul(2));
  for (let distribution = 0; distribution < numberOfDistributions; ++distribution) {
    await (
      await merkleOrchard
        .connect(rewarder)
        .seedAllocations(rewardToken.address, distribution, merkleRoot, rewardAmount.mul(2))
    ).wait();
  }

  // We need to initialize the bitmaps to a nonzero value so that we can see
  // their effect on the claimer's gas costs.
  // This is done by performing a claim on each distribution.
  const rewarderClaims: Claim[] = Array.from({ length: numberOfDistributions }, (_, distribution) => ({
    rewardToken: rewardToken.address,
    rewarder: rewarder.address,
    distribution,
    index: 0,
    balance: rewardAmount,
    merkleProof: [merkleLeaves[1]],
  }));

  // After this, future claimers benefit from being able to reuse the same storage slots
  await (await merkleOrchard.connect(rewarder).claimDistributions(rewarder.address, rewarderClaims)).wait();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
