import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address'
import { Contract, ContractReceipt, Signer } from 'ethers';
import { ethers } from 'hardhat';
import { deploy } from './deploy';

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
  // We could reuse this factory if we saved it across tokenizer deployments

  const authorizer = await ethers.getContractAt('Authorizer', await vault.getAuthorizer());
  await authorizer.connect(admin).grantRole(await authorizer.ADD_UNIVERSAL_AGENT_ROLE(), factory.address);

  const salt = ethers.utils.id(Math.random().toString());
  const name = 'Balancer Pool Token';
  const symbol = 'BPT';
  const receipt: ContractReceipt = await (
    await factory.connect(args.from).create(name, symbol, ...args.parameters, salt)
  ).wait();

  const event = receipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  return ethers.getContractAt(poolName, event.args?.pool);
}
