import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts, tenderly } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const vault = await deployments.get('Vault');

  const weightedFactory = await deploy('WeightedPoolFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
  });

  if (hre.network.live) {
    await tenderly.push({
      name: 'WeightedPoolFactory',
      address: weightedFactory.address,
    });
  }

  const stableFactory = await deploy('StablePoolFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
  });

  if (hre.network.live) {
    await tenderly.push({
      name: 'StablePoolFactory',
      address: stableFactory.address,
    });
  }
}
