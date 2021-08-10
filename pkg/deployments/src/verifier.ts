import fetch, { Response } from 'node-fetch';
import { BuildInfo, CompilerInput, Network } from 'hardhat/types';
import { getLongVersion } from '@nomiclabs/hardhat-etherscan/dist/src/solc/version';
import { encodeArguments } from '@nomiclabs/hardhat-etherscan/dist/src/ABIEncoder';

import {
  Bytecode,
  ContractInformation,
  extractMatchingContractInformation,
} from '@nomiclabs/hardhat-etherscan/dist/src/solc/bytecode';

import {
  EtherscanURLs,
  getEtherscanEndpoints,
  retrieveContractBytecode,
} from '@nomiclabs/hardhat-etherscan/dist/src/network/prober';

import {
  toVerifyRequest,
  toCheckStatusRequest,
  EtherscanVerifyRequest,
} from '@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanVerifyContractRequest';

import EtherscanResponse, {
  delay,
  getVerificationStatus,
} from '@nomiclabs/hardhat-etherscan/dist/src/etherscan/EtherscanService';

import Task from './task';
import logger from './logger';

const MAX_VERIFICATION_INTENTS = 3;

export default class Verifier {
  apiKey: string;
  network: Network;

  constructor(_network: Network, _apiKey: string) {
    this.network = _network;
    this.apiKey = _apiKey;
  }

  async call(task: Task, name: string, address: string, constructorArguments: unknown, intent = 1): Promise<string> {
    const response = await this.verify(task, name, address, constructorArguments);

    if (response.isVerificationSuccess()) {
      const etherscanAPIEndpoints = await getEtherscanEndpoints(this.network.provider, this.network.name);
      const contractURL = new URL(`/address/${address}#code`, etherscanAPIEndpoints.browserURL);
      return contractURL.toString();
    } else if (intent < MAX_VERIFICATION_INTENTS && response.isBytecodeMissingInNetworkError()) {
      logger.info(`Could not find deployed bytecode in network, retrying ${intent++}/${MAX_VERIFICATION_INTENTS}...`);
      delay(5000);
      return this.call(task, name, address, constructorArguments, intent++);
    } else {
      throw new Error(`The contract verification failed. Reason: ${response.message}`);
    }
  }

  private async verify(task: Task, name: string, address: string, args: unknown): Promise<EtherscanResponse> {
    const deployedBytecodeHex = await retrieveContractBytecode(address, this.network.provider, this.network.name);
    const deployedBytecode = new Bytecode(deployedBytecodeHex);
    const buildInfo = await task.buildInfo(name);
    const sourceName = this.findContractSourceName(buildInfo, name);
    const contractInformation = await extractMatchingContractInformation(sourceName, name, buildInfo, deployedBytecode);
    if (!contractInformation) throw Error('Could not find a bytecode matching the requested contract');

    const deployArgumentsEncoded = await encodeArguments(
      contractInformation.contract.abi,
      contractInformation.sourceName,
      contractInformation.contractName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args as any[]
    );

    const solcFullVersion = await getLongVersion(contractInformation.solcVersion);
    const etherscanAPIEndpoints = await getEtherscanEndpoints(this.network.provider, this.network.name);

    const minimumBuildVerificationStatus = await this.attemptVerification(
      etherscanAPIEndpoints,
      contractInformation,
      address,
      this.apiKey,
      buildInfo.input,
      solcFullVersion,
      deployArgumentsEncoded
    );

    if (minimumBuildVerificationStatus.isVerificationSuccess()) return minimumBuildVerificationStatus;

    const verificationStatus = await this.attemptVerification(
      etherscanAPIEndpoints,
      contractInformation,
      address,
      this.apiKey,
      contractInformation.compilerInput,
      solcFullVersion,
      deployArgumentsEncoded
    );

    if (verificationStatus.isVerificationSuccess()) return verificationStatus;
    throw new Error(`The contract verification failed. Reason: ${verificationStatus.message}`);
  }

  private async attemptVerification(
    etherscanAPIEndpoints: EtherscanURLs,
    contractInformation: ContractInformation,
    contractAddress: string,
    etherscanAPIKey: string,
    compilerInput: CompilerInput,
    solcFullVersion: string,
    deployArgumentsEncoded: string
  ): Promise<EtherscanResponse> {
    compilerInput.settings.libraries = contractInformation.libraryLinks;
    const request = toVerifyRequest({
      apiKey: etherscanAPIKey,
      contractAddress,
      sourceCode: JSON.stringify(compilerInput),
      sourceName: contractInformation.sourceName,
      contractName: contractInformation.contractName,
      compilerVersion: solcFullVersion,
      constructorArguments: deployArgumentsEncoded,
    });

    const response = await this.verifyContract(etherscanAPIEndpoints.apiURL, request);
    const pollRequest = toCheckStatusRequest({ apiKey: etherscanAPIKey, guid: response.message });

    await delay(700);
    const verificationStatus = await getVerificationStatus(etherscanAPIEndpoints.apiURL, pollRequest);

    if (verificationStatus.isVerificationFailure() || verificationStatus.isVerificationSuccess()) {
      return verificationStatus;
    }

    throw new Error(`The API responded with an unexpected message: ${verificationStatus.message}`);
  }

  private async verifyContract(url: string, req: EtherscanVerifyRequest): Promise<EtherscanResponse> {
    const parameters = new URLSearchParams({ ...req });
    const requestDetails = { method: 'post', body: parameters };

    let response: Response;
    try {
      response = await fetch(url, requestDetails);
    } catch (error) {
      throw Error(`Failed to send verification request. Reason: ${error.message}`);
    }

    if (!response.ok) {
      const responseText = await response.text();
      throw Error(`Failed to send verification request.\nHTTP code: ${response.status}.\nResponse: ${responseText}`);
    }

    const etherscanResponse = new EtherscanResponse(await response.json());
    if (!etherscanResponse.isOk()) throw Error(etherscanResponse.message);
    return etherscanResponse;
  }

  private findContractSourceName(buildInfo: BuildInfo, contractName: string): string {
    const names = this.getAllFullyQualifiedNames(buildInfo);
    const contractMatches = names.filter((name) => name.contractName === contractName);
    if (contractMatches.length === 0) throw Error('Could not find a bytecode matching the requested contract');
    if (contractMatches.length > 1) throw Error('More than one contract was found to match the deployed bytecode');
    return contractMatches[0].sourceName;
  }

  private getAllFullyQualifiedNames(buildInfo: BuildInfo): Array<{ sourceName: string; contractName: string }> {
    const contracts = buildInfo.output.contracts;
    return Object.keys(contracts).reduce((names: { sourceName: string; contractName: string }[], sourceName) => {
      const contractsNames = Object.keys(contracts[sourceName]);
      const qualifiedNames = contractsNames.map((contractName) => ({ sourceName, contractName }));
      return names.concat(qualifiedNames);
    }, []);
  }
}
