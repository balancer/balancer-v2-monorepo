import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { TokenList } from '@balancer-labs/v2-helpers/src/tokens';
import { setupEnvironment } from './misc';
import { printGas } from '@balancer-labs/v2-helpers/src/numbers';
import { BytesLike, solidityKeccak256 } from 'ethers/lib/utils';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';

interface Claim {
  distribution: BigNumber;
  balance: BigNumber;
  rewarder: string;
  rewardToken: string;
  merkleProof: BytesLike[];
}

let vault: Contract;
let tokens: TokenList;
let trader: SignerWithAddress;

async function main() {
  ({ vault, tokens, trader } = await setupEnvironment());

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
  const merkleLeaf = solidityKeccak256(['address', 'uint256'], [trader.address, rewardAmount]);

  const claims: Claim[] = Array.from({ length: numberOfDistributions }, (_, distribution) => ({
    distribution: BigNumber.from(distribution),
    balance: rewardAmount,
    rewarder: trader.address,
    rewardToken: rewardToken.address,
    merkleProof: [],
  }));

  await rewardToken.connect(trader).approve(merkleOrchard.address, rewardAmount.mul(numberOfDistributions));
  for (let distribution = 0; distribution < numberOfDistributions; ++distribution) {
    await (
      await merkleOrchard.connect(trader).seedAllocations(rewardToken.address, distribution, merkleLeaf, rewardAmount)
    ).wait();
  }

  let receipt;
  if (useInternalBalance) {
    receipt = await (
      await merkleOrchard.connect(trader).claimDistributionsToInternalBalance(trader.address, claims)
    ).wait();
  } else {
    receipt = await (await merkleOrchard.connect(trader).claimDistributions(trader.address, claims)).wait();
  }

  console.log(
    `${numberOfDistributions} claims: ${printGas(receipt.gasUsed)} (${printGas(
      receipt.gasUsed / numberOfDistributions
    )} per claim)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
