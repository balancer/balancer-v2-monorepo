import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const vault = await deployments.get('Vault');

  await deploy('WeightedPoolFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
  });

  await deploy('StablePoolFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
  });
}
