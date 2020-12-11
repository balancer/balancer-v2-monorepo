import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getChainId, getNamedAccounts } = hre;
  const { deploy, execute, read } = deployments;

  const { admin } = await getNamedAccounts();

  const chainId = await getChainId();

  const vault = await deployments.get('Vault');

  const weightedPoolFactory = await deploy('WeightedPoolFactory', {
    from: admin,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  const stablePoolFactory = await deploy('StablePoolFactory', {
    from: admin,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  // The factories need to be granted permission to add universal agents, so that they can create pools

  const addUniversalAgentRole = await read('Authorizer', {}, 'ADD_UNIVERSAL_AGENT_ROLE');

  await execute(
    'Authorizer',
    {
      from: admin,
      log: true,
    },
    'grantRole',
    addUniversalAgentRole,
    weightedPoolFactory.address
  );

  await execute(
    'Authorizer',
    {
      from: admin,
      log: true,
    },
    'grantRole',
    addUniversalAgentRole,
    stablePoolFactory.address
  );
};
export default func;
