import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getChainId, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();

  const vault = await deployments.get('Vault');

  if (chainId == '31337') {
    await deploy('MockFlashLoanReceiver', {
      from: deployer,
      args: [vault.address],
      log: true,
      deterministicDeployment: true,
    });
  }
};
export default func;
