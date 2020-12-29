import { deploy } from '../helpers/deploy';
import { ethers } from 'hardhat';
import { printGas } from './misc';
import { Contract } from 'ethers';

async function main() {
  const [, admin] = await ethers.getSigners();

  const vault = await measureDeployment('Vault', [admin.address]);

  await measureDeployment('ConstantProductPoolFactory', [vault.address]);

  await measureDeployment('StablecoinPoolFactory', [vault.address]);
}

async function measureDeployment(name: string, args: Array<unknown>): Promise<Contract> {
  console.log(`# ${name}`);

  const contract = await deploy(name, { args });

  const deployReceipt = await ethers.provider.getTransactionReceipt(contract.deployTransaction.hash);
  console.log(`Deployment costs ${printGas(deployReceipt.gasUsed.toNumber())}`);

  const deployedBytecode = await ethers.provider.getCode(contract.address);
  const bytecodeSizeKb = deployedBytecode.slice(2).length / 2 / 1024;

  console.log(`Deployed bytecode size is ${bytecodeSizeKb} kB`);

  return contract;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
