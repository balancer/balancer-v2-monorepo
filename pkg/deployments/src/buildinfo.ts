import { BuildInfo } from 'hardhat/types';

export function findContractSourceName(buildInfo: BuildInfo, contractName: string): string {
  const names = getAllFullyQualifiedNames(buildInfo);
  const contractMatches = names.filter((name) => name.contractName === contractName);
  if (contractMatches.length === 0)
    throw Error(`Could not find a source file for the requested contract ${contractName}`);
  if (contractMatches.length > 1) throw Error(`More than one source file was found to match ${contractName}`);
  return contractMatches[0].sourceName;
}

export function getAllFullyQualifiedNames(buildInfo: BuildInfo): Array<{ sourceName: string; contractName: string }> {
  const contracts = buildInfo.output.contracts;
  return Object.keys(contracts).reduce((names: { sourceName: string; contractName: string }[], sourceName) => {
    const contractsNames = Object.keys(contracts[sourceName]);
    const qualifiedNames = contractsNames.map((contractName) => ({ sourceName, contractName }));
    return names.concat(qualifiedNames);
  }, []);
}
