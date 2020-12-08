import { ethers, deployments } from 'hardhat';
import { printGas } from './misc';

async function main() {
  console.log('# Vault');
  let receipt;
  let vaultDeployment: any = await deployments.getOrNull('Vault');
  if(vaultDeployment === null || vaultDeployment === undefined){
    const [deployer] = await ethers.getSigners();

    const { deploy } = deployments;

    vaultDeployment = await deploy('Vault', {
      from: deployer.address,
      args: [deployer.address],
      log: true,
      deterministicDeployment: true,
    });

    receipt = vaultDeployment.receipt;
    console.log(`Deployment costs ${printGas(receipt.gasUsed.toNumber())}`);
  }else{
    receipt = vaultDeployment.receipt;
    console.log(`Deployment costs ${printGas(ethers.BigNumber.from(receipt.gasUsed))}`);
  }

  const deployedBytecode = await ethers.provider.getCode(vaultDeployment.address);
  const bytecodeSizeKb = deployedBytecode.slice(2).length / 2 / 1024;

  console.log(`Deployed bytecode size is ${bytecodeSizeKb} kB`);

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
