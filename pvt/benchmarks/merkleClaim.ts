import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { setupEnvironment } from './misc';
import { printGas } from '@balancer-labs/v2-helpers/src/numbers';
import { BytesLike, solidityKeccak256 } from 'ethers/lib/utils';
import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';

interface Claim {
  distributionId: BigNumber;
  balance: BigNumber;
  distributor: string;
  tokenIndex: BigNumber;
  merkleProof: BytesLike[];
}

let vault: Vault;
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

  const token = tokens.first;
  const tokenAddresses = tokens.subset(1).addresses;
  const amount = BigNumber.from(100);
  const merkleLeaf = solidityKeccak256(['address', 'uint256'], [trader.address, amount]);

  const claims: Claim[] = Array.from({ length: numberOfDistributions }, (_, distribution) => ({
    distributionId: BigNumber.from(distribution),
    balance: amount,
    distributor: trader.address,
    tokenIndex: BigNumber.from(0),
    merkleProof: [],
  }));

  await token.approve(merkleOrchard.address, amount.mul(numberOfDistributions), { from: trader });
  for (let distribution = 0; distribution < numberOfDistributions; ++distribution) {
    await (
      await merkleOrchard.connect(trader).createDistribution(token.address, merkleLeaf, amount, distribution)
    ).wait();
  }

  let receipt;
  if (useInternalBalance) {
    receipt = await (
      await merkleOrchard.connect(trader).claimDistributionsToInternalBalance(trader.address, claims, tokenAddresses)
    ).wait();
  } else {
    receipt = await (
      await merkleOrchard.connect(trader).claimDistributions(trader.address, claims, tokenAddresses)
    ).wait();
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
