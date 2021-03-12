import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../types/types';
import { BigNumberish } from '../../../../lib/helpers/numbers';

export type VaultDeployment = {
  admin?: Account;
  emergencyPeriod?: BigNumberish;
  emergencyPeriodCheckExtension?: BigNumberish;
  from?: SignerWithAddress;
  mocked?: boolean;
};
