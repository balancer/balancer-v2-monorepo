import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber, BigNumberish } from '../../../numbers';
import { Account } from '../../types/types';

export type RecoveryModeExitParams = {
  bptIn: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  tokens?: string[];
  currentBalances?: BigNumberish[];
};

export type JoinExitBasePool = {
  recipient?: Account;
  currentBalances?: BigNumberish[];
  tokens?: string[];
  lastChangeBlock?: BigNumberish;
  protocolFeePercentage?: BigNumberish;
  data?: string;
  from?: SignerWithAddress;
};

export type ExitResult = {
  amountsOut: BigNumber[];
  dueProtocolFeeAmounts: BigNumber[];
};

export type MultiExitGivenIn = {
  bptIn: BigNumberish;
  recipient?: Account;
  from?: SignerWithAddress;
  currentBalances?: BigNumberish[];
  protocolFeePercentage?: BigNumberish;
  lastChangeBlock?: BigNumberish;
};

export enum FailureMode {
  INVARIANT,
  PRICE_RATE,
}
