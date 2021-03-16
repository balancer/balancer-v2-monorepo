import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const authorizer = await deployments.get('Authorizer');
  const vault = await deployments.get('Vault');

  await deploy('WeightedPoolFactory', {
    from: deployer,
    args: [authorizer.address, vault.address],
    log: true,
    deterministicDeployment: true,
  });

  await deploy('StablePoolFactory', {
    from: deployer,
    args: [authorizer.address, vault.address],
    log: true,
    deterministicDeployment: true,
  });
}
