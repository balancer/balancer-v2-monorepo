import { Contract } from 'ethers';
import { Interface } from 'ethers/lib/utils';

export const actionId = (instance: Contract, method: string, contractInterface?: Interface): Promise<string> => {
  const selector = contractInterface ? contractInterface.getSighash(method) : instance.interface.getSighash(method);
  return instance.getActionId(selector);
};
