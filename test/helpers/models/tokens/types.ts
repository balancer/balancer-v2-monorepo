import { NAry, Account } from '../types/types';
import { BigNumberish } from '../../../../lib/helpers/numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

export type RawTokensDeployment = number | NAry<RawTokenDeployment>;

export type RawTokenDeployment =
  | string
  | {
      name?: string;
      symbol?: string;
      decimals?: number;
      from?: SignerWithAddress;
    };

export type TokenDeployment = {
  name: string;
  symbol: string;
  decimals: number;
  from?: SignerWithAddress;
};

export type RawTokenMint = NAry<{
  to: NAry<Account>;
  from?: SignerWithAddress;
  amount?: BigNumberish;
}>;

export type TokenMint = {
  to: Account;
  from?: SignerWithAddress;
  amount?: BigNumberish;
};

export type RawTokenApproval = NAry<{
  to: NAry<Account>;
  from?: NAry<SignerWithAddress>;
  amount?: BigNumberish;
}>;

export type TokenApproval = {
  to: Account;
  from?: SignerWithAddress;
  amount?: BigNumberish;
};

export type TxParams = {
  from?: SignerWithAddress;
};
