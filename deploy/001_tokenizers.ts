import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const vault = await deployments.get('Vault');

  const fixedSetFactory = await deploy('FixedSetPoolTokenizerFactory', {
    from: deployer,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  const ownableFixedSetFactory = await deploy('OwnableFixedSetPoolTokenizerFactory', {
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
    fixedSetFactory.address
  );

  await execute(
    'Vault',
    {
      from: deployer,
      log: true,
    },
    'addUniversalAgentManager',
    ownableFixedSetFactory.address
  );
};
export default func;
