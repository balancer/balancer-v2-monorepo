import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { BigNumberish } from '../../../../lib/helpers/numbers';

export type RawVaultDeployment = {
  mocked?: boolean;
  admin?: SignerWithAddress;
  responseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  from?: SignerWithAddress;
};

export type VaultDeployment = {
  mocked: boolean;
  responseWindowDuration: BigNumberish;
  bufferPeriodDuration: BigNumberish;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type JoinPool = {
  poolAddress: string;
  poolId: string;
  recipient: string;
  currentBalances: BigNumberish[];
  tokens: string[];
  lastChangeBlock: BigNumberish;
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
  lastChangeBlock: BigNumberish;
  protocolFeePercentage: BigNumberish;
  data: string;
  minAmountsOut?: BigNumberish[];
  toInternalBalance?: boolean;
  from?: SignerWithAddress;
};
