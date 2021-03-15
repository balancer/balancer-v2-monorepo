import { ethers } from 'hardhat';
import { Contract, ContractReceipt, Signer } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from './deploy';
import { ZERO_ADDRESS } from './constants';

export const GeneralPool = 0;
export const MinimalSwapInfoPool = 1;
export const TwoTokenPool = 2;

export type PoolSpecializationSetting = typeof MinimalSwapInfoPool | typeof GeneralPool | typeof TwoTokenPool;
export type PoolName = 'WeightedPool' | 'StablePool';

/**
 * Deploys a Pool via a Factory contract.
 *
 * @param vault The Vault contract.
 * @param admin The account with admin powers over the Vault's Authorizer.
 * @param poolName The name of the Pool contract. The factory must have the same name, with the 'Factory'
 * suffix.
 * @param args An object with the signer that will call the factory and the arguments for the Pool's constructor.
 */
export async function deployPoolFromFactory(
  vault: Contract,
  admin: Signer,
  poolName: PoolName,
  args: { from: SignerWithAddress; parameters: Array<unknown> }
): Promise<Contract> {
  const factory = await deploy(`${poolName}Factory`, { args: [vault.address] });
  // We could reuse this factory if we saved it across pool deployments

  const name = 'Balancer Pool Token';
  const symbol = 'BPT';
  const emergencyPeriod = 0;
  const emergencyPeriodCheckExtension = 0;

  const receipt: ContractReceipt = await (
    await factory
      .connect(args.from)
      .create(name, symbol, ...args.parameters, emergencyPeriod, emergencyPeriodCheckExtension)
  ).wait();

  const event = receipt.events?.find((e) => e.event == 'PoolRegistered');
  if (event == undefined) {
    throw new Error('Could not find PoolRegistered event');
  }

  return ethers.getContractAt(poolName, event.args?.pool);
}
