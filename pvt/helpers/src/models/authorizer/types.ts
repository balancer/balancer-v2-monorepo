import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../types/types';

export type TimelockAuthorizerDeployment = {
  vault?: Account;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};
