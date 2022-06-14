import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../types/types';
import { BigNumberish } from '../../numbers';

export type TimelockAuthorizerDeployment = {
  vault?: Account;
  admin?: SignerWithAddress;
  rootTransferDelay?: BigNumberish;
  from?: SignerWithAddress;
};
