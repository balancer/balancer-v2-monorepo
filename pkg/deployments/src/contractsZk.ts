import { ContractInterface, utils } from 'ethers';
import * as zk from 'zksync-web3';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { getSigner } from './signers';
import { ZkSyncArtifact, Libraries, Param } from './types';
import { HardhatNetworkAccountConfig, HardhatRuntimeEnvironment, HttpNetworkConfig } from 'hardhat/types';

export async function deployZk(
  artifact: ZkSyncArtifact,
  args: Array<Param> = [],
  from?: SignerWithAddress,
  factoryDeps?: string[],
  libs?: Libraries
): Promise<zk.Contract> {
  if (!args) args = [];
  if (!from) from = await getSigner();
  // if (libs) artifact = linkBytecode(artifact, libs);

  const hre: HardhatRuntimeEnvironment = await import('hardhat');
  const { config } = hre;
  const zkProvider = new zk.Provider((hre.network.config as HttpNetworkConfig).url);
  const accounts = config.networks.zkTestnet.accounts as HardhatNetworkAccountConfig[];
  const zkSigner = new zk.Wallet(accounts[0] as unknown as utils.BytesLike, zkProvider);

  const factory = new zk.ContractFactory(
    artifact.abi as ContractInterface,
    artifact.bytecode as utils.BytesLike,
    zkSigner
  );
  const deployment = await factory.deploy(...args, {
    customData: {
      factoryDeps,
    },
  });
  return deployment.deployed();
}
