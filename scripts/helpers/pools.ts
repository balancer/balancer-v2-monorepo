import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract, ContractReceipt } from 'ethers';
import { MAX_UINT256 } from '../../test/helpers/constants';
import { TokenList } from '../../test/helpers/tokens';
import { ethers } from 'hardhat';
import { deploy } from './deploy';

export const PairTS = 0;
export const TupleTS = 1;
export const TwoTokenTS = 2;

export type TradingStrategyType = typeof PairTS | typeof TupleTS | typeof TwoTokenTS;

export async function createPool(
  vault: Contract,
  strategy: Contract,
  strategyType: number,
  controller: SignerWithAddress
): Promise<string> {
  const receipt: ContractReceipt = await (
    await vault.connect(controller).newPool(strategy.address, strategyType)
  ).wait();

  const event = receipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  return event.args?.poolId;
}

export async function setupPool(
  vault: Contract,
  strategy: Contract,
  strategyType: number,
  tokens: TokenList,
  controller: SignerWithAddress,
  makeup: Array<[string, string]>
): Promise<string> {
  const poolId = createPool(vault, strategy, strategyType, controller);

  for (const entry of makeup) {
    const token = tokens[entry[0]];

    await token.mint(controller.address, entry[1]);
    await token.connect(controller).approve(vault.address, MAX_UINT256);
  }

  const tokenAddresses = makeup.map((entry) => tokens[entry[0]].address);
  const amounts = makeup.map((entry) => entry[1]);

  // Don't withdraw from user balance
  await vault.connect(controller).addLiquidity(poolId, controller.address, tokenAddresses, amounts, false);

  return poolId;
}

export type PoolName = 'ConstantProductPool' | 'StablecoinPool';

/**
 * Deploys a Pool via a Factory contract.
 *
 * @param vault The Vault contract.
 * @param admin The admin of the Vault.
 * @param poolName The name of the Pool contract. The factory must have the same name, with the 'Factory'
 * suffix.
 * @param args An object with the signer that will call the factory and the arguments for the Pool's constructor.
 */
export async function deployPoolFromFactory(
  vault: Contract,
  admin: SignerWithAddress,
  poolName: PoolName,
  args: { from: SignerWithAddress; parameters: Array<unknown> }
): Promise<Contract> {
  const factory = await deploy(`${poolName}Factory`, { args: [vault.address] });
  // We could reuse this factory if we saved it accross tokenizer deployments

  // Authorize factory so that created pool are trusted operators
  await vault.connect(admin).authorizeTrustedOperatorReporter(factory.address);

  const salt = ethers.utils.id(Math.random().toString());

  const receipt: ContractReceipt = await (await factory.connect(args.from).create(...args.parameters, salt)).wait();

  const event = receipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }

  return ethers.getContractAt(poolName, event.args?.pool);
}
