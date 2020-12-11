import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();

  await deploy('CWPFactory', {
    from: admin,
    args: [],
    log: true,
    deterministicDeployment: true,
  });

  await deploy('FlattenedFactory', {
    from: admin,
    args: [],
    log: true,
    deterministicDeployment: true,
  });
};
export default func;
