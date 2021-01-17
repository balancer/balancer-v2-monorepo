import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';
import { Contract, Wallet } from 'ethers';
import { EIP712Domain, domainSeparator } from '../helpers/EIP712';
import ethSigUtil from 'eth-sig-util';
import { expect } from 'chai';


describe('EIP712', function () {
  let mailTo: SignerWithAddress;
  let eip712: Contract;
  let chainId: BigInteger;

  const name = 'A Name';
  const version = '1';

  before('deploy base contracts', async () => {
      [mailTo] = await ethers.getSigners();

      eip712 = await deploy('EIP712', { args: [name, version] });

      chainId = await eip712.getChainId();
  });

  it('domain separator', async function () {
    expect(
      await eip712.domainSeparator(),
    ).to.equal(
      await domainSeparator(name, version, chainId, eip712.address),
    );
  });

  it('digest', async function () {
    const verifyingContract = eip712.address;
    const message = {
      to: mailTo,
      contents: 'very interesting',
    };

    const data = {
      types: {
        EIP712Domain,
        Mail: [
          { name: 'to', type: 'address' },
          { name: 'contents', type: 'string' },
        ],
      },
      domain: { name, version, chainId, verifyingContract },
      primaryType: 'Mail',
      message,
    };

    const wallet = Wallet.createRandom();
    const signature = ethSigUtil.signTypedMessage(Buffer.from(wallet.privateKey), { data });

    await eip712.verify(signature, wallet.address, message.to, message.contents);
  });
});
