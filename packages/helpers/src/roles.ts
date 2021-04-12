import { ethers } from 'hardhat';
import { Contract } from 'ethers';

export const roleId = (instance: Contract, method: string): string => {
  const signature = instance.interface.getSighash(method);
  return ethers.utils.solidityKeccak256(['address', 'bytes4'], [instance.address, signature]);
};
