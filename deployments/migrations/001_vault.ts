import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts, tenderly } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const authorizer = await deployments.get('Authorizer');

  const vault = await deploy('Vault', {
    from: deployer,
    args: [authorizer.address, 0, 0],
    log: true,
    deterministicDeployment: true,
  });

  if (hre.network.live && vault.newlyDeployed) {
    await tenderly.push({
      name: 'Vault',
      address: vault.address,
    });
  }
}
