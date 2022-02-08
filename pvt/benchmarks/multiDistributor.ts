import { BigNumber, ContractReceipt } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { setupEnvironment } from './misc';
import { printGas } from '@balancer-labs/v2-helpers/src/numbers';
import TokenList from '@balancer-labs/v2-helpers/src/models/tokens/TokenList';
import { MultiDistributor } from '@balancer-labs/v2-helpers/src/models/distributor/MultiDistributor';
import Vault from '@balancer-labs/v2-helpers/src/models/vault/Vault';
import { advanceTime } from '@balancer-labs/v2-helpers/src/time';
import { actionId } from '@balancer-labs/v2-helpers/src/models/misc/actions';
import Token from '@balancer-labs/v2-helpers/src/models/tokens/Token';

let vault: Vault;
let tokens: TokenList;
let trader: SignerWithAddress;
let others: SignerWithAddress[];

const DISTRIBUTION_DURATION = 100;
const DISTRIBUTION_AMOUNT = BigNumber.from(100);

async function main() {
  ({ vault, tokens, trader, others } = await setupEnvironment());

  for (let i = 1; i <= 5; i++) {
    console.log(`\n# Subscribing to ${i} distributions`);

    await subscribeToDistributions(i, true);
    await subscribeToDistributions(i, false);
  }

  for (let i = 1; i <= 5; i++) {
    console.log(`\n# Unsubscribing from ${i} distributions`);

    await unsubscribeFromDistributions(i, true);
    await unsubscribeFromDistributions(i, false);
  }

  for (let i = 1; i <= 5; i++) {
    console.log(`\n# Staking while subscribed to ${i} distributions`);

    await stakeIntoDistributions(i, true);
    await stakeIntoDistributions(i, false);
  }

  for (let i = 1; i <= 5; i++) {
    console.log(`\n# Unstaking while subscribed to ${i} distributions`);

    await unstakeFromDistributions(i);
    await unstakeFromDistributions(i);
  }

  for (let i = 1; i <= 5; i++) {
    console.log(`\n# Claiming from ${i} distributions`);

    await claimDistributions(i, false);
    await claimDistributions(i, true);
  }
}

async function createDistributions(
  distributor: MultiDistributor,
  stakingToken: Token,
  distributionToken: Token,
  numberOfDistributions: number
): Promise<string[]> {
  const distributionIds = [];
  for (let i = 0; i < numberOfDistributions; i++) {
    const distributionOwner = others[i];

    // Create distribution
    await distributor.newDistribution(stakingToken, distributionToken, DISTRIBUTION_DURATION, {
      from: distributionOwner,
    });
    const distributionId = await distributor.getDistributionId(stakingToken, distributionToken, distributionOwner);

    // Fund distribution
    await distributionToken.mint(distributionOwner, DISTRIBUTION_AMOUNT);
    await distributionToken.approve(distributor, DISTRIBUTION_AMOUNT, { from: distributionOwner });
    await distributor.fundDistribution(distributionId, DISTRIBUTION_AMOUNT, { from: distributionOwner });

    distributionIds.push(distributionId);
  }
  return distributionIds;
}

async function subscribeToDistributions(numberOfDistributions: number, withStake: boolean) {
  const distributor = await MultiDistributor.create(vault);

  const [stakingToken, distributionToken] = tokens.subset(2).tokens;

  const distributionIds = await createDistributions(
    distributor,
    stakingToken,
    distributionToken,
    numberOfDistributions
  );

  if (withStake) {
    // stake tokens
    const amount = BigNumber.from(100);
    await stakingToken.approve(distributor, amount, { from: trader });
    await distributor.stake(stakingToken, amount, trader, trader, { from: trader });
  }

  await advanceTime(DISTRIBUTION_DURATION / 2);

  // Subscribe
  const receipt = await (await distributor.subscribe(distributionIds, { from: trader })).wait();

  console.log(
    `${numberOfDistributions} distributions (${withStake ? 'with stake' : 'without stake'}): ${printGas(
      receipt.gasUsed
    )} (${printGas(receipt.gasUsed.div(numberOfDistributions))} per subscription)`
  );
}

async function unsubscribeFromDistributions(numberOfDistributions: number, withStake: boolean) {
  const distributor = await MultiDistributor.create(vault);

  const [stakingToken, distributionToken] = tokens.subset(2).tokens;

  const distributionIds = await createDistributions(
    distributor,
    stakingToken,
    distributionToken,
    numberOfDistributions
  );

  if (withStake) {
    // stake tokens
    const amount = BigNumber.from(100);
    await stakingToken.approve(distributor, amount, { from: trader });
    await distributor.stake(stakingToken, amount, trader, trader, { from: trader });
  }

  await advanceTime(DISTRIBUTION_DURATION / 4);
  await distributor.subscribe(distributionIds, { from: trader });
  await advanceTime(DISTRIBUTION_DURATION / 4);

  // Subscribe
  const receipt = await (await distributor.unsubscribe(distributionIds, { from: trader })).wait();

  console.log(
    `${numberOfDistributions} distributions (${withStake ? 'with stake' : 'without stake'}): ${printGas(
      receipt.gasUsed
    )} (${printGas(receipt.gasUsed.div(numberOfDistributions))} per subscription)`
  );
}

async function stakeIntoDistributions(numberOfDistributions: number, stakeUsingVault: boolean) {
  const distributor = await MultiDistributor.create(vault);

  const [stakingToken, distributionToken] = tokens.subset(2).tokens;

  const distributionIds = await createDistributions(
    distributor,
    stakingToken,
    distributionToken,
    numberOfDistributions
  );

  await advanceTime(DISTRIBUTION_DURATION / 2);

  // Subscribe
  await distributor.subscribe(distributionIds, { from: trader });

  // stake tokens
  const amount = BigNumber.from(100);
  await stakingToken.approve(distributor, amount, { from: trader });

  let receipt: ContractReceipt;
  if (stakeUsingVault) {
    const action = await actionId(vault.instance, 'manageUserBalance');
    await vault.grantPermissionsGlobally([action], distributor);

    await vault.setRelayerApproval(trader, distributor, true);

    receipt = await (await distributor.stakeUsingVault(stakingToken, amount, trader, trader, { from: trader })).wait();
  } else {
    receipt = await (await distributor.stake(stakingToken, amount, trader, trader, { from: trader })).wait();
  }

  console.log(
    `${numberOfDistributions} distributions (${stakeUsingVault ? 'relayer' : 'vault'}): ${printGas(
      receipt.gasUsed
    )} (${printGas(receipt.gasUsed.div(numberOfDistributions))} per subscription)`
  );
}

async function unstakeFromDistributions(numberOfDistributions: number) {
  const distributor = await MultiDistributor.create(vault);

  const [stakingToken, distributionToken] = tokens.subset(2).tokens;

  const distributionIds = await createDistributions(
    distributor,
    stakingToken,
    distributionToken,
    numberOfDistributions
  );

  await advanceTime(DISTRIBUTION_DURATION / 2);

  // Subscribe
  await distributor.subscribe(distributionIds, { from: trader });

  // stake tokens
  const amount = BigNumber.from(100);
  await stakingToken.approve(distributor, amount, { from: trader });
  await distributor.stake(stakingToken, amount, trader, trader, { from: trader });

  const receipt = await (await distributor.unstake(stakingToken, amount, trader, trader, { from: trader })).wait();

  console.log(
    `${numberOfDistributions} distributions: ${printGas(receipt.gasUsed)} (${printGas(
      receipt.gasUsed.div(numberOfDistributions)
    )} per subscription)`
  );
}

async function claimDistributions(numberOfDistributions: number, useInternalBalance: boolean) {
  const distributor = await MultiDistributor.create(vault);

  const [stakingToken, distributionToken] = tokens.subset(2).tokens;

  const distributionIds = await createDistributions(
    distributor,
    stakingToken,
    distributionToken,
    numberOfDistributions
  );

  // Subscribe
  await distributor.subscribe(distributionIds, { from: trader });

  // stake tokens
  const amount = BigNumber.from(100);
  await stakingToken.approve(distributor, amount, { from: trader });
  await distributor.stake(stakingToken, amount, trader, trader, { from: trader });

  await advanceTime(DISTRIBUTION_DURATION / 2);

  const receipt = await (
    await distributor.claim(distributionIds, useInternalBalance, trader, trader, { from: trader })
  ).wait();

  console.log(
    `${numberOfDistributions} claims (${useInternalBalance ? 'Internal' : 'External'}): ${printGas(
      receipt.gasUsed
    )} (${printGas(receipt.gasUsed.div(numberOfDistributions))} per claim)`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
