export function valuesAfter(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] !== flag) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.push(value);
  }
  return values;
}

export function valueAfter(argv: string[], flag: string): string | undefined {
  return valuesAfter(argv, flag)[0];
}
