import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute, read } = deployments;

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

  // The factories need to be granted permission to add universal agents, so that they can create pools

  const addUniversalAgentRole = await read('Authorizer', {}, 'ADD_UNIVERSAL_AGENT_ROLE');

  await execute(
    'Authorizer',
    {
      from: deployer,
      log: true,
    },
    'grantRole',
    addUniversalAgentRole,
    constantProductPoolFactory.address
  );

  await execute(
    'Authorizer',
    {
      from: deployer,
      log: true,
    },
    'grantRole',
    addUniversalAgentRole,
    stablecoinPoolFactory.address
  );
};
export default func;
