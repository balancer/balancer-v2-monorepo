import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getChainId, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { admin } = await getNamedAccounts();

  const chainId = await getChainId();

  const vault = await deployments.get('Vault');

  if (chainId == '31337') {
    await deploy('MockPoolControllerFactory', {
      from: admin,
      args: [vault.address],
      log: true,
      deterministicDeployment: true,
    });

    await deploy('MockTradingStrategy', {
      from: admin,
      log: true,
      deterministicDeployment: true,
    });

    await deploy('MockTradingStrategyReentrancy', {
      from: admin,
      args: [vault.address],
      log: true,
      deterministicDeployment: true,
    });

    await deploy('MockFlashLoanReceiver', {
      from: admin,
      args: [vault.address],
      log: true,
      deterministicDeployment: true,
    });

    await deploy('EnumerableUintToAddressMapMock', {
      from: admin,
      log: true,
      deterministicDeployment: true,
    });

    await deploy('EnumerableIERC20ToBytes32MapMock', {
      from: admin,
      log: true,
      deterministicDeployment: true,
    });
  }
};
export default func;
