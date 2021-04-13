import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getChainId, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  // Deploy on mainnet to keep nonces synced
  await deploy('TokenFactory', {
    from: deployer,
    log: true,
  });

  await deploy('WETH', {
    from: deployer,
    args: [deployer],
    log: true,
  });

  await deploy('Multicall', {
    from: deployer,
    log: true,
  });
}
