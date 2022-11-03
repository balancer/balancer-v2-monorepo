import { ethers } from 'hardhat';
import { BigNumberish, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import { deploy } from '../../contract';
import { MONTH } from '../../time';
import { ANY_ADDRESS, ZERO_ADDRESS } from '../../constants';
import { RawVaultDeployment, VaultDeployment } from './types';

import Vault from './Vault';
import TypesConverter from '../types/TypesConverter';
import TokensDeployer from '../tokens/TokensDeployer';
import { actionId } from '../misc/actions';

export default {
  async deploy(params: RawVaultDeployment): Promise<Vault> {
    const deployment = TypesConverter.toVaultDeployment(params);

    let { admin } = deployment;
    const { from, mocked } = deployment;
    if (!admin) admin = from || (await ethers.getSigners())[0];

    // Needed so that the getAuthorizerAdaptor() call in the Authorizer constructor will not revert
    const mockEntrypoint = await deploy('v2-liquidity-mining/MockAuthorizerAdaptorEntrypoint');

    // Deploy the Vault with a placeholder authorizer
    const authorizer = await this._deployAuthorizer(admin, mockEntrypoint, from);
    const vault = await (mocked ? this._deployMocked : this._deployReal)(deployment, authorizer);

    // Deploy the authorizer adaptor and entrypoint
    const authorizerAdaptor = await this._deployAuthorizerAdaptor(vault, from);
    const authorizerAdaptorEntrypoint = await this._deployAuthorizerAdaptorEntrypoint(vault, authorizerAdaptor, from);

    // Redeploy the authorizer with the entrypoint
    const newAuthorizer = await this._deployAuthorizer(admin, authorizerAdaptorEntrypoint, from, vault.address);

    // Change authorizer to the one with the entrypoint
    const action = await actionId(vault, 'setAuthorizer');
    await authorizer.connect(admin).grantPermissions([action], admin.address, [ANY_ADDRESS]);
    await vault.connect(admin).setAuthorizer(newAuthorizer.address);

    const protocolFeeProvider = await this._deployProtocolFeeProvider(
      vault,
      deployment.maxYieldValue,
      deployment.maxAUMValue
    );

    return new Vault(
      mocked,
      vault,
      newAuthorizer,
      authorizerAdaptor,
      authorizerAdaptorEntrypoint,
      protocolFeeProvider,
      admin
    );
  },

  async _deployReal(deployment: VaultDeployment, authorizer: Contract): Promise<Contract> {
    const { from, pauseWindowDuration, bufferPeriodDuration } = deployment;
    const weth = await TokensDeployer.deployToken({ symbol: 'WETH' });

    const args = [authorizer.address, weth.address, pauseWindowDuration, bufferPeriodDuration];
    return deploy('v2-vault/Vault', { args, from });
  },

  async _deployMocked({ from }: VaultDeployment, authorizer: Contract): Promise<Contract> {
    return deploy('v2-pool-utils/MockVault', { from, args: [authorizer.address] });
  },

  async _deployAuthorizer(
    admin: SignerWithAddress,
    authorizerAdaptorEntrypoint: Contract,
    from?: SignerWithAddress,
    vault?: string
  ): Promise<Contract> {
    return deploy('v2-vault/TimelockAuthorizer', {
      args: [admin.address, vault || ZERO_ADDRESS, authorizerAdaptorEntrypoint.address ?? ZERO_ADDRESS, MONTH],
      from,
    });
  },

  async _deployAuthorizerAdaptor(vault: Contract, from?: SignerWithAddress): Promise<Contract> {
    return deploy('v2-liquidity-mining/AuthorizerAdaptor', { args: [vault.address], from });
  },

  async _deployAuthorizerAdaptorEntrypoint(
    vault: Contract,
    adaptor: Contract,
    from?: SignerWithAddress
  ): Promise<Contract> {
    return deploy('v2-liquidity-mining/AuthorizerAdaptorEntrypoint', { args: [adaptor.address], from });
  },

  async _deployProtocolFeeProvider(
    vault: Contract,
    maxYieldValue: BigNumberish,
    maxAUMValue: BigNumberish
  ): Promise<Contract> {
    return deploy('v2-standalone-utils/ProtocolFeePercentagesProvider', {
      args: [vault.address, maxYieldValue, maxAUMValue],
    });
  },
};
