import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

export type AuthorizerDeployment = {
  admin?: SignerWithAddress;
  from?: SignerWithAddress;
};
