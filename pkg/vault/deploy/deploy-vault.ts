import { MONTH } from '@balancer-labs/v2-helpers/src/time';
import { Deployer } from '@matterlabs/hardhat-zksync';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Wallet } from 'zksync-ethers';

export default async function (hre: HardhatRuntimeEnvironment) {
  // Initialize the wallet.
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  const wallet = new Wallet(pk);

  // Create deployer object and load the artifact of the contract we want to deploy.
  const deployer = new Deployer(hre, wallet);

  // Load contract
  const artifact = await deployer.loadArtifact('Vault');

  const authorizer = '0x17523132CBbA36befb35DCBf9b8D153a0cefCD58';
  const pauseWindow = 4 * 12 * MONTH; // 4 years
  const bufferPeriod = 6 * MONTH; // 1 year
  const WETH = '0x6bDc36E20D267Ff0dd6097799f82e78907105e2F';

  const vault = await deployer.deploy(artifact, [authorizer, WETH, pauseWindow, bufferPeriod]);
}
