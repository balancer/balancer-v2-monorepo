import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { BigNumberish } from '../../../../numbers';

export type EditOrder = {
  ref?: string;
  amount: BigNumberish;
  price: BigNumberish;
  from?: SignerWithAddress;
};

export type CancelOrder = {
  ref?: string;
  from?: SignerWithAddress;
};

export type OrderRef = {
  from?: SignerWithAddress;
};