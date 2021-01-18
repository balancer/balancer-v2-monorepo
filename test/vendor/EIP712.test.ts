import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { deploy } from '../../scripts/helpers/deploy';
import { EIP712Domain, domainSeparator } from './helpers/EIP712';
import { Contract, Wallet, BigNumber } from 'ethers';
import { expect } from 'chai';

describe('EIP712', function () {
  let mailTo: SignerWithAddress;
  let eip712: Contract;
  let chainId: BigInteger;

  const name = 'A Name';
  const symbol = 'A Symbol';
  const version = '1'

  before('deploy base contracts', async () => {
      [mailTo] = await ethers.getSigners();

      eip712 = await deploy('MockBalancerPoolToken', { args: [name, symbol, mailTo.address, BigNumber.from((100e18).toString())] });

      chainId = await eip712.getChainId();
  });

  xit('domain separator', async function () {
    expect(
      await eip712.DOMAIN_SEPARATOR(),
    ).to.equal(
      await domainSeparator(name, version, chainId, eip712.address),
    );
  });

  xit('digest', async function () {
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
    // This doesn't compile
    // const signature = ethSigUtil.signTypedMessage(Buffer.from(wallet.privateKey), { data });

    // await eip712.verify(signature, wallet.address, message.to, message.contents);
  });
});
