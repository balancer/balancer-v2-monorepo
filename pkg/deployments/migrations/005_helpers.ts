import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const vault = await deployments.get('Vault');

  await deploy('BalancerHelpers', {
    from: deployer,
    args: [vault.address],
    log: true,
  });
}
