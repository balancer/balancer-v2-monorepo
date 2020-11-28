import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, tenderly } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const vault = await deployments.get('Vault');

  const tradescript = await deploy('TradeScript', {
    from: deployer,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  if (hre.network.live && tradescript.newlyDeployed) {
    await tenderly.push({
      name: 'TradeScript',
      address: tradescript.address
    });
  }
};
export default func;
