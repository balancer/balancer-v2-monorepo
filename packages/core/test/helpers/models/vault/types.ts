import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { BigNumberish } from '@balancer-labs/v2-helpers/src/numbers';

export type RawVaultDeployment = {
  mocked?: boolean;
  admin?: SignerWithAddress;
  emergencyPeriod?: BigNumberish;
  emergencyPeriodCheckExtension?: BigNumberish;
  from?: SignerWithAddress;
};

export type VaultDeployment = {
  mocked: boolean;
  emergencyPeriod: BigNumberish;
  emergencyPeriodCheckExtension: BigNumberish;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type JoinPool = {
  poolAddress: string;
  poolId: string;
  recipient: string;
  currentBalances: BigNumberish[];
  tokens: string[];
  latestBlockNumberUsed: BigNumberish;
  protocolFeePercentage: BigNumberish;
  data: string;
  maxAmountsIn?: BigNumberish[];
  fromInternalBalance?: boolean;
  from?: SignerWithAddress;
};

export type ExitPool = {
  poolAddress: string;
  poolId: string;
  recipient: string;
  currentBalances: BigNumberish[];
  tokens: string[];
  latestBlockNumberUsed: BigNumberish;
  protocolFeePercentage: BigNumberish;
  data: string;
  minAmountsOut?: BigNumberish[];
  toInternalBalance?: boolean;
  from?: SignerWithAddress;
};
