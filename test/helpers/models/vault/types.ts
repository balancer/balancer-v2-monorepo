import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { BigNumberish } from '../../../../lib/helpers/numbers';

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

export type JoinExitPool = {
  poolAddress: string;
  poolId: string;
  recipient: string;
  currentBalances: BigNumberish[];
  latestBlockNumberUsed: BigNumberish;
  protocolFeePercentage: BigNumberish;
  data: string;
  from?: SignerWithAddress;
};
