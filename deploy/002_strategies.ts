import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy('CWPFactory', {
    from: deployer,
    args: [],
    log: true,
    deterministicDeployment: true,
  });

  await deploy('FlattenedFactory', {
    from: deployer,
    args: [],
    log: true,
    deterministicDeployment: true,
  });
};
export default func;
