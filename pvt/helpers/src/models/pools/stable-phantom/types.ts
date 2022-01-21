import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { BigNumberish } from '../../../numbers';

import Vault from '../../vault/Vault';
import Token from '../../tokens/Token';
import TokenList from '../../tokens/TokenList';
import { Account } from '../../types/types';

export type RawStablePhantomPoolDeployment = {
  tokens?: TokenList;
  swapFeePercentage?: BigNumberish;
  amplificationParameter?: BigNumberish;
  rateProviders?: Account[];
  tokenRateCacheDurations?: BigNumberish[];
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
  tokenRateCacheDurations: BigNumberish[];
  pauseWindowDuration?: BigNumberish;
  bufferPeriodDuration?: BigNumberish;
  owner?: SignerWithAddress;
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};

export type SwapPhantomPool = {
  in: Token;
  out: Token;
  amount: BigNumberish;
  balances?: BigNumberish[];
  recipient?: Account;
  from?: SignerWithAddress;
  lastChangeBlock?: BigNumberish;
  data?: string;
};
