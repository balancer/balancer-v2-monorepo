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
  const artifact = await deployer.loadArtifact('Authorizer');

  const initialAdmin = '0xDA07B188daE2ee63B2eC61Ee4cdB9673C03d2293';
  const authorizerContract = await deployer.deploy(artifact, [initialAdmin]);
}
