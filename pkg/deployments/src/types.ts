import { Contract, BigNumber } from 'ethers';
import { CompilerOutputBytecode } from 'hardhat/types';

import Task from './task';

export const NETWORKS = ['goerli', 'kovan', 'mainnet', 'rinkeby', 'ropsten', 'polygon'];

export type Network = typeof NETWORKS[number];

export type NAry<T> = T | Array<T>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Param = boolean | string | number | BigNumber | any;

export type Input = {
  [key: string]: NAry<Param>;
};

export type RawInputByNetwork = {
  [key in Network]: RawInputKeyValue;
};

export type RawInputKeyValue = {
  [key: string]: NAry<Param> | Output | Task;
};

export type RawInput = RawInputKeyValue | RawInputByNetwork;

export type Output = {
  [key: string]: string;
};

export type RawOutput = {
  [key: string]: string | Contract;
};

export type Artifact = {
  abi: { [key: string]: string };
  evm: {
    bytecode: CompilerOutputBytecode;
    deployedBytecode: CompilerOutputBytecode;
    methodIdentifiers: {
      [methodSignature: string]: string;
    };
  };
};
