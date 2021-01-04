import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract, ContractReceipt } from 'ethers';
import { ethers } from 'hardhat';
import { deploy } from './deploy';

export const PairTS = 0;
export const TupleTS = 1;
export const TwoTokenTS = 2;

export type TradingStrategyType = typeof PairTS | typeof TupleTS | typeof TwoTokenTS;
export type PoolName = 'ConstantProductPool' | 'StablecoinPool';

/**
 * Deploys a Pool via a Factory contract.
 *
 * @param vault The Vault contract.
 * @param poolName The name of the Pool contract. The factory must have the same name, with the 'Factory'
 * suffix.
 * @param args An object with the signer that will call the factory and the arguments for the Pool's constructor.
 */
export async function deployPoolFromFactory(
  vault: Contract,
  poolName: PoolName,
  args: { from: SignerWithAddress; parameters: Array<unknown> }
): Promise<Contract> {
  const factory = await deploy(`${poolName}Factory`, { args: [vault.address] });
  // We could reuse this factory if we saved it accross tokenizer deployments

  const authorizer = await ethers.getContractAt('MockAuthorizer', await vault.getAuthorizer());

  // We're going to temporarily make the factory the authorized account, and then restore the original authorized one
  const oldAuthorized = await authorizer.getAuthorized();
  await authorizer.setAuthorized(factory.address);
  await authorizer.setCanAddUniversalAgent(true);

  const salt = ethers.utils.id(Math.random().toString());

  const receipt: ContractReceipt = await (await factory.connect(args.from).create(...args.parameters, salt)).wait();

  await authorizer.setAuthorized(oldAuthorized);

  const event = receipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  return ethers.getContractAt(poolName, event.args?.pool);
}
