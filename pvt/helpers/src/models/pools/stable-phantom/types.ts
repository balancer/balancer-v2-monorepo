import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { BigNumberish } from '../../../numbers';

import Vault from '../../vault/Vault';
import TokenList from '../../tokens/TokenList';
import { Account } from '../../types/types';

export type RawStablePhantomPoolDeployment = {
  tokens?: TokenList;
  swapFeePercentage?: BigNumberish;
  amplificationParameter?: BigNumberish;
  rateProviders?: Account[];
  priceRateCacheDurations?: BigNumberish[];
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
  vault?: Vault;
  mockedVault?: boolean;
};

export type StablePhantomPoolDeployment = {
  tokens: TokenList;
  swapFeePercentage: BigNumberish;
  amplificationParameter: BigNumberish;
  rateProviders: Account[];
  priceRateCacheDurations: BigNumberish[];
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type SwapPhantomPool = {
  in: number;
  out: number;
  amount: BigNumberish;
  balances: BigNumberish[];
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  data?: string;
};
