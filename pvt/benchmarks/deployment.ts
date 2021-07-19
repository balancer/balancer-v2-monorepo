import { ethers } from 'hardhat';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

async function main() {
  const [, admin] = await ethers.getSigners();

  console.log('== Deployment measurements ==');

  const authorizer = await deploy('v2-vault/Authorizer', { args: [admin.address] });

  const vault = await measureDeployment('v2-vault/Vault', [authorizer.address, ZERO_ADDRESS, 0, 0]);

  await measureDeployment('v2-pool-weighted/WeightedPoolFactory', [vault.address]);

  await measureDeployment('v2-pool-weighted/WeightedPool2TokensFactory', [vault.address]);

  await measureDeployment('v2-pool-stable/StablePoolFactory', [vault.address]);

  await measureDeployment('v2-pool-weighted/LiquidityBootstrappingPoolFactory', [vault.address]);

  await measureDeployment('v2-pool-weighted/InvestmentPoolFactory', [vault.address]);
}

async function measureDeployment(name: string, args: Array<unknown>): Promise<Contract> {
  console.log(`\n# ${name}`);

  const contract = await deploy(name, { args });
  const deployedBytecode = await ethers.provider.getCode(contract.address);
  const bytecodeSizeKb = (deployedBytecode.slice(2).length / 2 / 1024).toFixed(3);

  console.log(`Deployed bytecode size is ${bytecodeSizeKb} kB`);

  return contract;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
