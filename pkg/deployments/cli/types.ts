import { Overrides } from 'ethers';
import { Signer } from 'ethers';
import { Network } from '../src/types';

export type Deployer = Signer;
export interface ScriptRunEnvironment {
  network: Network;
  deployer: Deployer;
  transactionOverrides: Overrides;
}

export interface CliProps {
  environment: ScriptRunEnvironment;
  parentCli?: Cli;
}

export interface Output<ContractInput, ContractOutput> {
  transaction: {
    hash: string;
    blockNumber: number | undefined;
  };
  data: {
    [key: string]: {
      [key: string]: {
        input: ContractInput;
        output: ContractOutput;
      };
    };
  };
}

export type Cli = (props: CliProps) => Promise<void>;
