import { MaxUint256 as MAX_DEADLINE } from '@ethersproject/constants';
import { Contract } from '@ethersproject/contracts';
import { hexValue, hexZeroPad, splitSignature } from '@ethersproject/bytes';
import { BigNumberish } from '@ethersproject/bignumber';
import { Signer, TypedDataSigner } from '@ethersproject/abstract-signer';

export type Account = string | Signer | Contract;

export async function accountToAddress(account: Account): Promise<string> {
  if (typeof account == 'string') return account;
  if (Signer.isSigner(account)) return account.getAddress();
  if (account.address) return account.address;
  throw new Error('Could not read account address');
}

export enum RelayerAction {
  JoinPool = 'JoinPool',
  ExitPool = 'ExitPool',
  Swap = 'Swap',
  BatchSwap = 'BatchSwap',
  SetRelayerApproval = 'SetRelayerApproval',
}

export class RelayerAuthorization {
  /**
   * Cannot be constructed.
   */
  private constructor() {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  }

  static encodeCalldataAuthorization = (calldata: string, deadline: BigNumberish, signature: string): string => {
    const encodedDeadline = hexZeroPad(hexValue(deadline), 32).slice(2);
    const { v, r, s } = splitSignature(signature);
    const encodedV = hexZeroPad(hexValue(v), 32).slice(2);
    const encodedR = r.slice(2);
    const encodedS = s.slice(2);
    return `${calldata}${encodedDeadline}${encodedV}${encodedR}${encodedS}`;
  };

  static signJoinAuthorization = (
    validator: Contract,
    user: Signer & TypedDataSigner,
    allowedSender: Account,
    allowedCalldata: string,
    deadline?: BigNumberish,
    nonce?: BigNumberish
  ): Promise<string> =>
    RelayerAuthorization.signAuthorizationFor(
      RelayerAction.JoinPool,
      validator,
      user,
      allowedSender,
      allowedCalldata,
      deadline,
      nonce
    );

  static signExitAuthorization = (
    validator: Contract,
    user: Signer & TypedDataSigner,
    allowedSender: Account,
    allowedCalldata: string,
    deadline?: BigNumberish,
    nonce?: BigNumberish
  ): Promise<string> =>
    RelayerAuthorization.signAuthorizationFor(
      RelayerAction.ExitPool,
      validator,
      user,
      allowedSender,
      allowedCalldata,
      deadline,
      nonce
    );

  static signSwapAuthorization = (
    validator: Contract,
    user: Signer & TypedDataSigner,
    allowedSender: Account,
    allowedCalldata: string,
    deadline?: BigNumberish,
    nonce?: BigNumberish
  ): Promise<string> =>
    RelayerAuthorization.signAuthorizationFor(
      RelayerAction.Swap,
      validator,
      user,
      allowedSender,
      allowedCalldata,
      deadline,
      nonce
    );

  static signBatchSwapAuthorization = (
    validator: Contract,
    user: Signer & TypedDataSigner,
    allowedSender: Account,
    allowedCalldata: string,
    deadline?: BigNumberish,
    nonce?: BigNumberish
  ): Promise<string> =>
    RelayerAuthorization.signAuthorizationFor(
      RelayerAction.BatchSwap,
      validator,
      user,
      allowedSender,
      allowedCalldata,
      deadline,
      nonce
    );

  static signSetRelayerApprovalAuthorization = (
    validator: Contract,
    user: Signer & TypedDataSigner,
    allowedSender: Account,
    allowedCalldata: string,
    deadline?: BigNumberish,
    nonce?: BigNumberish
  ): Promise<string> =>
    RelayerAuthorization.signAuthorizationFor(
      RelayerAction.SetRelayerApproval,
      validator,
      user,
      allowedSender,
      allowedCalldata,
      deadline,
      nonce
    );

  static signAuthorizationFor = async (
    type: RelayerAction,
    validator: Contract,
    user: Signer & TypedDataSigner,
    allowedSender: Account,
    allowedCalldata: string,
    deadline: BigNumberish = MAX_DEADLINE,
    nonce?: BigNumberish
  ): Promise<string> => {
    const { chainId } = await validator.provider.getNetwork();
    if (!nonce) {
      const userAddress = await user.getAddress();
      nonce = (await validator.getNextNonce(userAddress)) as BigNumberish;
    }

    const domain = {
      name: 'Balancer V2 Vault',
      version: '1',
      chainId,
      verifyingContract: validator.address,
    };

    const types = {
      [type]: [
        { name: 'calldata', type: 'bytes' },
        { name: 'sender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    const value = {
      calldata: allowedCalldata,
      sender: await accountToAddress(allowedSender),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    };

    return user._signTypedData(domain, types, value);
  };
}
