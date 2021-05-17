import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../types/types';

export type AuthorizerDeployment = {
  admin?: Account;
  from?: SignerWithAddress;
};
