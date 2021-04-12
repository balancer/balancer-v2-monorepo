import { ethers } from 'hardhat';
import { printGas } from './misc';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/deploy';
import { ZERO_ADDRESS } from '@balancer-labs/v2-helpers/src/constants';

async function main() {
  const [, admin] = await ethers.getSigners();

  const authorizer = await deploy('Authorizer', { args: [admin.address] });

  const vault = await measureDeployment('Vault', [authorizer.address, ZERO_ADDRESS, 0, 0]);

  await measureDeployment('WeightedPoolFactory', [vault.address]);

  await measureDeployment('StablePoolFactory', [vault.address]);
}

async function measureDeployment(name: string, args: Array<unknown>): Promise<Contract> {
  console.log(`# ${name}`);

  const contract = await deploy(name, { args });

  const deployReceipt = await ethers.provider.getTransactionReceipt(contract.deployTransaction.hash);
  console.log(`Deployment costs ${printGas(deployReceipt.gasUsed.toNumber())}`);

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
