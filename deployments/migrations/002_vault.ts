import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { MONTH } from '../../lib/helpers/time';

export default async function (hre: HardhatRuntimeEnvironment): Promise<void> {
  const { deployments, getNamedAccounts, getChainId, tenderly } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId();

  const authorizer = await deployments.get('Authorizer');
  const THREE_MONTHS = MONTH * 3;
  let WETH;

  if (chainId == '1') {
    WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  } else {
    WETH = await (await deployments.get('WETH')).address;
  }

  const vault = await deploy('Vault', {
    from: deployer,
    args: [authorizer.address, WETH, THREE_MONTHS, MONTH],
    log: true,
  });

  if (hre.network.live && vault.newlyDeployed) {
    await tenderly.push({
      name: 'Vault',
      address: vault.address,
    });
  }
}
