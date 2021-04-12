import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Account } from '../types/types';

export type AuthorizerDeployment = {
  admin?: Account;
  from?: SignerWithAddress;
};
