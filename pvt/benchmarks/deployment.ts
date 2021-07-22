import { getArtifact } from '@balancer-labs/v2-helpers/src/contract';

async function main() {
  console.log('== Deployment measurements ==');

  await measureDeployment('v2-vault/Vault');

  await measureDeployment('v2-pool-weighted/WeightedPool');

  await measureDeployment('v2-pool-weighted/WeightedPool2TokensFactory');

  await measureDeployment('v2-pool-weighted/LiquidityBootstrappingPool');

  await measureDeployment('v2-pool-stable/StablePoolFactory');

  await measureDeployment('v2-pool-stable/meta/MetaStablePool');
}

async function measureDeployment(name: string) {
  console.log(`\n# ${name}`);

  const artifact = await getArtifact(name);
  const bytecodeSizeKb = (artifact.deployedBytecode.slice(2).length / 2 / 1024).toFixed(3);

  console.log(`Deployed bytecode size is ${bytecodeSizeKb} kB`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
