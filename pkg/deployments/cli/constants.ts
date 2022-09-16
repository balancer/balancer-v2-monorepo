import { Overrides } from 'ethers';

export const GAS_PRICE = 90000 * 10 ** 9;
export const GAS_LIMIT = 1000000;

export const transactionOverrides: Overrides = {
  gasPrice: GAS_PRICE,
  gasLimit: GAS_LIMIT,
};
