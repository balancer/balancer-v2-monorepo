import { Contract } from 'ethers';

export const roleId = (instance: Contract, method: string): Promise<string> => {
  const selector = instance.interface.getSighash(method);
  return instance.getRole(selector);
};
