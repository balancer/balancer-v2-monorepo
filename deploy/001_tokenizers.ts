import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getChainId, getNamedAccounts } = hre;
  const { deploy, execute } = deployments;

  const { admin } = await getNamedAccounts();

  const chainId = await getChainId();

  const vault = await deployments.get('Vault');

  const constantProductPoolFactory = await deploy('ConstantProductPoolFactory', {
    from: admin,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  const stablecoinPoolFactory = await deploy('StablecoinPoolFactory', {
    from: admin,
    args: [vault.address],
    log: true,
    deterministicDeployment: true,
  });

  await execute(
    'Vault',
    {
      from: admin,
      log: true,
    },
    'authorizeTrustedOperatorReporter',
    constantProductPoolFactory.address
  );

  await execute(
    'Vault',
    {
      from: admin,
      log: true,
    },
    'authorizeTrustedOperatorReporter',
    stablecoinPoolFactory.address
  );

  await execute(
    'Vault',
    {
      from: admin,
      log: true,
    },
    'authorizeTrustedOperatorReporter',
    constantProductPoolFactory.address
  );
};
export default func;
