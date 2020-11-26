import { deploy } from '../helpers/deploy';
import { ethers } from 'hardhat';
import { printGas } from './misc';

async function main() {
  console.log('# Vault');

  const vault = await deploy('Vault', { args: [] });

  const deployReceipt = await ethers.provider.getTransactionReceipt(vault.deployTransaction.hash);
  console.log(`Deployment costs ${printGas(deployReceipt.gasUsed.toNumber())}`);

  const deployedBytecode = await ethers.provider.getCode(vault.address);
  const bytecodeSizeKb = deployedBytecode.slice(2).length / 2 / 1024;

  console.log(`Deployed bytecode size is ${bytecodeSizeKb} kB`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
