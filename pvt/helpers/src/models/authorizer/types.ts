import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { Account } from '../types/types';
import { BigNumberish } from '../../numbers';

export type TimelockAuthorizerDeployment = {
  vault?: Account;
  root?: SignerWithAddress;
  nextRoot?: Account;
  rootTransferDelay?: BigNumberish;
  from?: SignerWithAddress;
};
