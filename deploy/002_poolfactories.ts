import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const vault = await deployments.get('Vault');

  await deploy('WeightedPoolFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  await deploy('StablePoolFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });
};
export default func;
