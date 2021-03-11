import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../types/types';

export type VaultDeployment = {
  admin?: Account;
  from?: SignerWithAddress;
  mocked?: boolean;
};
