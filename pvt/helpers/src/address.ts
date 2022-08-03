import { ethers } from 'hardhat';
import { ANY_ADDRESS } from './constants';

/**
 * Creates an array of pseudo random addresses.
 * @param seed Number to start generating the pseudo random addresses. Use different inputs to get different outputs.
 * @param amount Number of addresses to create.
 */
export const anyAddressArray = (seed: number, amount: number): string[] => {
  let addresses: string[] = [];
  let lastSeed = ethers.utils.hexlify(seed);

  for (let i = 0; i < amount; i++) {
    let address: string = ethers.utils.keccak256(lastSeed).slice(0, ANY_ADDRESS.length);
    addresses.push(address);
    lastSeed = address;
  }

  return addresses;
}
