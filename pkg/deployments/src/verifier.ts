import fetch, { Response } from 'node-fetch';
import { BuildInfo, CompilerInput, Network } from 'hardhat/types';

import { getLongVersion } from '@nomiclabs/hardhat-etherscan/dist/src/solc/version';
import { encodeArguments } from '@nomiclabs/hardhat-etherscan/dist/src/ABIEncoder';
import { getLibraryLinks, Libraries } from '@nomiclabs/hardhat-etherscan/dist/src/solc/libraries';

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

import * as parser from '@solidity-parser/parser';

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

  async call(
    task: Task,
    name: string,
    address: string,
    constructorArguments: string | unknown[],
    libraries: Libraries = {},
    intent = 1
  ): Promise<string> {
    const response = await this.verify(task, name, address, constructorArguments, libraries);

    if (response.isVerificationSuccess()) {
      const etherscanAPIEndpoints = await getEtherscanEndpoints(this.network.provider, this.network.name);
      const contractURL = new URL(`/address/${address}#code`, etherscanAPIEndpoints.browserURL);
      return contractURL.toString();
    } else if (intent < MAX_VERIFICATION_INTENTS && response.isBytecodeMissingInNetworkError()) {
      logger.info(`Could not find deployed bytecode in network, retrying ${intent++}/${MAX_VERIFICATION_INTENTS}...`);
      delay(5000);
      return this.call(task, name, address, constructorArguments, libraries, intent++);
    } else {
      throw new Error(`The contract verification failed. Reason: ${response.message}`);
    }
  }

  private async verify(
    task: Task,
    name: string,
    address: string,
    args: string | unknown[],
    libraries: Libraries = {}
  ): Promise<EtherscanResponse> {
    const deployedBytecodeHex = await retrieveContractBytecode(address, this.network.provider, this.network.name);
    const deployedBytecode = new Bytecode(deployedBytecodeHex);
    const buildInfos = await task.buildInfos();
    const buildInfo = this.findBuildInfoWithContract(buildInfos, name);
    buildInfo.input = this.trimmedBuildInfoInput(name, buildInfo.input);

    const sourceName = this.findContractSourceName(buildInfo, name);
    const contractInformation = await extractMatchingContractInformation(sourceName, name, buildInfo, deployedBytecode);
    if (!contractInformation) throw Error('Could not find a bytecode matching the requested contract');

    const { libraryLinks } = await getLibraryLinks(contractInformation, libraries);
    contractInformation.libraryLinks = libraryLinks;

    const deployArgumentsEncoded =
      typeof args == 'string'
        ? args
        : await encodeArguments(
            contractInformation.contract.abi,
            contractInformation.sourceName,
            contractInformation.contractName,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            args as any[]
          );

    const solcFullVersion = await getLongVersion(contractInformation.solcVersion);
    const etherscanAPIEndpoints = await getEtherscanEndpoints(this.network.provider, this.network.name);

    const verificationStatus = await this.attemptVerification(
      etherscanAPIEndpoints,
      contractInformation,
      address,
      this.apiKey,
      buildInfo.input,
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

  private findBuildInfoWithContract(buildInfos: BuildInfo[], contractName: string): BuildInfo {
    const found = buildInfos.find((buildInfo) =>
      this.getAllFullyQualifiedNames(buildInfo).some((name) => name.contractName === contractName)
    );

    if (found === undefined) {
      throw Error(`Could not find a build info for contract ${contractName}`);
    } else {
      return found;
    }
  }

  private findContractSourceName(buildInfo: BuildInfo, contractName: string): string {
    const names = this.getAllFullyQualifiedNames(buildInfo);
    const contractMatches = names.filter((name) => name.contractName === contractName);
    if (contractMatches.length === 0)
      throw Error(`Could not find a source file for the requested contract ${contractName}`);
    if (contractMatches.length > 1) throw Error(`More than one source file was found to match ${contractName}`);
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

  // Trims the inputs of the build info to only keep imported files, avoiding submitting unnecessary source files for
  // verification (e.g. mocks). This is required because Hardhat compiles entire projects at once, resulting in a single
  // huge build info.
  private trimmedBuildInfoInput(contractName: string, input: CompilerInput): CompilerInput {
    // First we find all sources imported from our contract
    const sourceName = this.getContractSourceName(contractName, input);
    const importedSourceNames = this.getContractImportedSourceNames(
      sourceName,
      input,
      new Set<string>().add(sourceName)
    );

    // Then, we keep only those inputs. This method also preserves the order of the files, which may be important in
    // some versions of solc.
    return {
      ...input,
      sources: Object.keys(input.sources)
        .filter((source) => importedSourceNames.has(source))
        .map((source) => ({ [source]: input.sources[source] }))
        .reduce((previous, current) => Object.assign(previous, current), {}),
    };
  }

  private getAbsoluteSourcePath(relativeSourcePath: string, input: CompilerInput): string {
    // We're not actually converting from relative to absolute but rather guessing: we'll extract the filename from the
    // relative path, and then look for a source name in the inputs that matches it.
    const contractName = (relativeSourcePath.match(/.*\/(\w*)\.sol/) as RegExpMatchArray)[1];
    return this.getContractSourceName(contractName, input);
  }

  private getContractSourceName(contractName: string, input: CompilerInput): string {
    const absoluteSourcePath = Object.keys(input.sources).find((absoluteSourcePath) =>
      absoluteSourcePath.includes(`/${contractName}.sol`)
    );

    if (absoluteSourcePath === undefined) {
      throw new Error(`Could not find source name for ${contractName}`);
    }

    return absoluteSourcePath;
  }

  private getContractImportedSourceNames(
    sourceName: string,
    input: CompilerInput,
    previousSourceNames: Set<string>
  ): Set<string> {
    const ast = parser.parse(input.sources[sourceName].content);
    parser.visit(ast, {
      ImportDirective: (node) => {
        // Imported paths might be relative, so we convert them to absolute
        const importedSourceName = this.getAbsoluteSourcePath(node.path, input);

        if (!previousSourceNames.has(importedSourceName)) {
          // New source!
          previousSourceNames = this.getContractImportedSourceNames(
            importedSourceName,
            input,
            new Set(previousSourceNames).add(importedSourceName)
          );
        }
      },
    });

    return previousSourceNames;
  }
}
