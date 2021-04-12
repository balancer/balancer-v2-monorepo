import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

export type NAry<T> = T | Array<T>;

export type Account = string | SignerWithAddress | Contract;

export type TxParams = {
  from?: SignerWithAddress;
};
