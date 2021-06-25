import fs from 'fs';
import path from 'path';
import { BuildInfo } from 'hardhat/types';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import logger from './logger';
import Verifier from './verifier';
import { deploy, instanceAt } from './contracts';
import { Artifact, Input, Network, NETWORKS, Output, Param, RawInput, RawInputKeyValue, RawOutput } from './types';

const TASKS_DIRECTORY = path.resolve(__dirname, '../tasks');

/* eslint-disable @typescript-eslint/no-var-requires */

export default class Task {
  id: string;
  _network?: Network;
  _verifier?: Verifier;
  _outputFile?: string;

  constructor(id: string, network?: Network, verifier?: Verifier) {
    this.id = id;
    this._network = network;
    this._verifier = verifier;
  }

  get outputFile(): string {
    return `${this._outputFile || this.network}.json`;
  }

  set outputFile(file: string) {
    this._outputFile = file;
  }

  get network(): string {
    if (!this._network) throw Error('A network must be specified to define a task');
    return this._network;
  }

  set network(name: Network) {
    this._network = name;
  }

  async deploy(name: string, args: Array<Param> = [], from?: SignerWithAddress): Promise<Contract> {
    const instance = await deploy(this.artifact(name), args, from);
    logger.success(`Deployed ${name} at ${instance.address}`);
    await this.verify(name, instance.address, args);
    return instance;
  }

  async verify(name: string, address: string, constructorArguments: unknown): Promise<void> {
    if (!this._verifier) return logger.warn('Avoiding contract verification, no verifier defined');
    const url = await this._verifier.call(this, name, address, constructorArguments);
    logger.success(`Verified contract ${name} at ${url}`);
  }

  async instanceAt(name: string, address: string): Promise<Contract> {
    return instanceAt(this.artifact(name), address);
  }

  async run(force = false, verify = false): Promise<void> {
    const taskPath = this._fileAt(this.dir(), 'index.ts');
    const task = require(taskPath).default;
    await task(this, force, verify);
  }

  dir(): string {
    if (!this.id) throw Error('Please provide a task deployment ID to run');
    return this._dirAt(TASKS_DIRECTORY, this.id);
  }

  buildInfo(fileName: string): BuildInfo {
    const abiDir = this._dirAt(this.dir(), 'abi');
    const artifactFile = this._fileAt(abiDir, `${fileName}.json`);
    return JSON.parse(fs.readFileSync(artifactFile).toString());
  }

  artifact(contractName: string, fileName: string = contractName): Artifact {
    const builds = this.buildInfo(fileName).output.contracts;
    const sourceName = Object.keys(builds).find((sourceName) =>
      Object.keys(builds[sourceName]).find((key) => key === contractName)
    );
    if (!sourceName) throw Error(`Could not find artifact for ${contractName}`);
    return builds[sourceName][contractName];
  }

  input(): Input {
    const taskInputPath = this._fileAt(this.dir(), 'input.ts');
    return this._parseRawInput(require(taskInputPath).default);
  }

  output({ ensure = true, network }: { ensure?: boolean; network?: Network } = {}): Output {
    if (network) this.network = network;
    const taskOutputDir = this._dirAt(this.dir(), 'output', ensure);
    const taskOutputFile = this._fileAt(taskOutputDir, this.outputFile, ensure);
    return this._read(taskOutputFile);
  }

  save(output: RawOutput): void {
    const taskOutputDir = this._dirAt(this.dir(), 'output', false);
    if (!fs.existsSync(taskOutputDir)) fs.mkdirSync(taskOutputDir);

    const taskOutputFile = this._fileAt(taskOutputDir, this.outputFile, false);
    const previousOutput = this._read(taskOutputFile);

    const finalOutput = { ...previousOutput, ...this._parseRawOutput(output) };
    this._write(taskOutputFile, finalOutput);
  }

  delete(): void {
    const taskOutputDir = this._dirAt(this.dir(), 'output');
    const taskOutputFile = this._fileAt(taskOutputDir, this.outputFile);
    fs.unlinkSync(taskOutputFile);
  }

  private _parseRawInput(rawInput: RawInput): Input {
    const rawInputWithoutNetwork = { ...rawInput };
    NETWORKS.forEach((network) => delete rawInputWithoutNetwork[network]);
    const inputWithoutNetwork = this._parseRawInputKeyValue(rawInputWithoutNetwork as RawInputKeyValue);
    const networkInput = rawInput[this.network]
      ? this._parseRawInputKeyValue(rawInput[this.network] as RawInputKeyValue)
      : {};

    Object.keys(networkInput).forEach((key) => {
      if (Object.keys(rawInputWithoutNetwork).includes(key)) {
        throw Error(`Duplicated key "${key}" in network ${this.network} and top-level input`);
      }
    });

    return { ...inputWithoutNetwork, ...networkInput };
  }

  private _parseRawInputKeyValue(rawInput: RawInputKeyValue): Input {
    return Object.keys(rawInput).reduce((input: Input, key: Network | string) => {
      const item = rawInput[key];
      if (Array.isArray(item)) input[key] = item;
      else if (BigNumber.isBigNumber(item)) input[key] = item;
      else if (typeof item !== 'object') input[key] = item;
      else {
        const isTask = item.constructor.name == 'Task';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const output: Output | any = isTask ? (item as Task).output({ network: this.network }) : item;
        input[key] = output[key] ? output[key] : output;
      }
      return input;
    }, {});
  }

  private _parseRawOutput(rawOutput: RawOutput): Output {
    return Object.keys(rawOutput).reduce((output: Output, key: string) => {
      const value = rawOutput[key];
      output[key] = typeof value === 'string' ? value : value.address;
      return output;
    }, {});
  }

  private _read(path: string): Output {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path).toString()) : {};
  }

  private _write(path: string, output: Output): void {
    const timestamp = new Date().getTime();
    const finalOutputJSON = JSON.stringify({ ...output, timestamp }, null, 2);
    fs.writeFileSync(path, finalOutputJSON);
  }

  private _fileAt(base: string, name: string, ensure = true): string {
    const filePath = path.join(base, name);
    if (ensure && !this._existsFile(filePath)) throw Error(`Could not find a file at ${filePath}`);
    return filePath;
  }

  private _dirAt(base: string, name: string, ensure = true): string {
    const dirPath = path.join(base, name);
    if (ensure && !this._existsDir(dirPath)) throw Error(`Could not find a directory at ${dirPath}`);
    return dirPath;
  }

  private _existsFile(filePath: string): boolean {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  }

  private _existsDir(dirPath: string): boolean {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  }
}
