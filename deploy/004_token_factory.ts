import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getChainId, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();

  if (chainId != '1') {
    await deploy('TokenFactory', {
      from: deployer,
      log: true,
      deterministicDeployment: true,
    });

    await deploy('WETH9', {
      from: deployer,
      args: [deployer],
      log: true,
      deterministicDeployment: true,
    });

    const multicall = await deploy('Multicall', {
      from: deployer,
      log: true,
      deterministicDeployment: true,
    });
  }
};
export default func;
