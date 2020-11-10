import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { Contract, ContractReceipt } from 'ethers';
import { ethers } from 'hardhat';
import { deploy } from './deploy';

/**
 * Deploys a Pool Controller via a Factory contract.
 *
 * @param vault The Vault contract.
 * @param admin The admin of the Vault.
 * @param signer The account to deploy the Controller from.
 * @param controllerName The name of the Controller contract. The factory must have the same name, with the 'Factory'
 * suffix.
 * @param parameters The arguments for the Contoller's constructor.
 */
export async function setupController(
  vault: Contract,
  admin: SignerWithAddress,
  signer: SignerWithAddress,
  controllerName: string,
  ...parameters: Array<unknown>
): Promise<Contract> {
  const factory = await deploy(`${controllerName}Factory`, { args: [vault.address] });
  // We could reuse this factory if we saved it accross tokenizer deployments

  // Authorize factory so that created controllers are trusted operators
  await vault.connect(admin).authorizeTrustedOperatorReporter(factory.address);

  const salt = ethers.utils.id(Math.random().toString());

  const receipt: ContractReceipt = await (await factory.connect(signer).create(...parameters, salt)).wait();

  const event = receipt.events?.find((e) => e.event == 'ControllerCreated');
  if (event == undefined) {
    throw new Error('Could not find ControllerCreated event');
  }

  return ethers.getContractAt(controllerName, event.args?.controller);
}
