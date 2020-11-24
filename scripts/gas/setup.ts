import { ethers } from 'hardhat';
import { Contract } from 'ethers';

export async function vaultStats(vault: Contract) {
  console.log('# Vault');

  const deployReceipt = await ethers.provider.getTransactionReceipt(vault.deployTransaction.hash);
  console.log(`Deployment costs ${printGas(deployReceipt.gasUsed.toNumber())}`);

  const deployedBytecode = await ethers.provider.getCode(vault.address);
  const bytecodeSizeKb = deployedBytecode.slice(2).length / 2 / 1024;

  console.log(`Deployed bytecode size is ${bytecodeSizeKb} kB`);
}

export function printGas(gas: number): string {
  return `${Math.trunc(gas / 1000)}k`;
}
