import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getChainId, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();

  const chainId = await getChainId();

  if (chainId != '1') {
    await deploy('TokenFactory', {
      from: admin,
      log: true,
      deterministicDeployment: true,
    });

    await deploy('WETH9', {
      from: admin,
      args: [admin],
      log: true,
      deterministicDeployment: true,
    });

    await deploy('Multicall', {
      from: admin,
      log: true,
      deterministicDeployment: true,
    });
  }
};
export default func;
