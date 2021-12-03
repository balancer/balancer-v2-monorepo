import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { setupEnvironment } from './misc';
import { printGas } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { MultiDistributor } from '@balancer-labs/v2-helpers/src/models/distributor/MultiDistributor';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';

let vault: Vault;
let tokens: TokenList;
let trader: SignerWithAddress;
let others: SignerWithAddress[];

async function main() {
  ({ vault, tokens, trader, others } = await setupEnvironment());

  for (let i = 1; i <= 5; i++) {
    console.log(`\n# Claiming from ${i} distributions`);

    await claimDistributions(i, false);
    await claimDistributions(i, true);
  }
}

async function claimDistributions(numberOfDistributions: number, useInternalBalance: boolean) {
  console.log(`\n## ${useInternalBalance ? 'Using Internal Balance' : 'Sending and receiving tokens'}`);

  const distributor = await MultiDistributor.create(vault);

  const [stakingToken, distributionToken] = tokens.subset(2).tokens;
  const amount = BigNumber.from(100);

  const DISTRIBUTION_DURATION = 100;
  const distributionChannelIds = [];
  for (let i = 0; i < numberOfDistributions; i++) {
    const distributionOwner = others[i];

    // Create distribution
    await distributor.newDistribution(stakingToken, distributionToken, DISTRIBUTION_DURATION, {
      from: distributionOwner,
    });
    const distributionChannelId = await distributor.getDistributionChannelId(
      stakingToken,
      distributionToken,
      distributionOwner
    );

    // Fund distribution
    await distributionToken.mint(distributionOwner, amount);
    await distributionToken.approve(distributor, amount, { from: distributionOwner });
    await distributor.fundDistribution(distributionChannelId, amount, { from: distributionOwner });

    // Subscribe
    await distributor.subscribe(distributionChannelId, { from: trader });
    distributionChannelIds.push(distributionChannelId);
  }

  // stake tokens
  await stakingToken.approve(distributor, amount, { from: trader });
  await distributor.stake(stakingToken, amount, trader, trader, { from: trader });

  await advanceTime(DISTRIBUTION_DURATION / 2);

  const receipt = await (
    await distributor.claim(distributionChannelIds, useInternalBalance, trader, trader, { from: trader })
  ).wait();

  console.log(
    `${numberOfDistributions} claims: ${printGas(receipt.gasUsed)} (${printGas(
      receipt.gasUsed.div(numberOfDistributions)
    )} per claim)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
