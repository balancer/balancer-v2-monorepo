import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const vault = await deployments.get('Vault');

  const constantProductPoolFactory = await deploy('ConstantProductPoolFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  const stablecoinPoolFactory = await deploy('StablecoinPoolFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  await execute(
    'Vault',
    {
      from: deployer,
      log: true,
    },
    'addUniversalAgentManager',
    constantProductPoolFactory.address
  );

  await execute(
    'Vault',
    {
      from: deployer,
      log: true,
    },
   'addUniversalAgentManager',
    stablecoinPoolFactory.address
  );
};
export default func;
