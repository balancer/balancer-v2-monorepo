import prompts from 'prompts';

export const addressPrompt = async (fieldName: string): Promise<string> => {
  const { address } = await prompts({
    type: 'text',
    name: 'address',
    message: `prompt ${fieldName} address`,
  });

  return address as string;
};

export const mapFunctionInput = async (inputType: string, inputName: string): Promise<string> => {
  switch (inputType) {
    case 'address':
      return addressPrompt(inputName);
    default:
      return '';
  }
};
