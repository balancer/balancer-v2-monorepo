import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { WEEK } from '@balancer-labs/v2-helpers/src/time';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts, tenderly } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const authorizer = await deployments.get('Authorizer');
  const weth = await deployments.get('WETH');

  const vault = await deploy('Vault', {
    from: deployer,
    args: [authorizer.address, weth.address, WEEK, WEEK],
    log: true,
  });

  if (hre.network.live && vault.newlyDeployed) {
    await tenderly.push({
      name: 'Vault',
      address: vault.address,
    });
  }
}
