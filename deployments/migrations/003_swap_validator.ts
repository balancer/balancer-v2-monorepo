import { HardhatRuntimeEnvironment } from 'hardhat/types';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts, tenderly } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const validatorScript = await deploy('OneToOneSwapValidator', {
    from: deployer,
    args: [],
    log: true,
    deterministicDeployment: true,
  });

  if (hre.network.live && validatorScript.newlyDeployed) {
    await tenderly.push({
      name: 'OneToOneSwapValidator',
      address: validatorScript.address,
    });
  }
}
