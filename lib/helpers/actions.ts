import { Contract } from 'ethers';

export const actionId = (instance: Contract, method: string): Promise<string> => {
  const selector = instance.interface.getSighash(method);
  return instance.getActionId(selector);
};
