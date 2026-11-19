export type R2ParentCredentials = {
  schemaVersion: 1;
  apiToken: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type R2TemporaryCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export type BrokerProcessRequest = {
  command: string;
  arguments: readonly string[];
  environment: Readonly<Record<string, string>>;
  inheritOutput: boolean;
};

export type BrokerProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type BrokerProcessRunner = (
  request: BrokerProcessRequest,
) => Promise<BrokerProcessResult>;

export type R2CredentialBrokerInput = {
  accountId: string;
  bucketPrefix: string;
  command: string;
  commandArguments: readonly string[];
  helperCommand: string;
  parentCredentials: R2ParentCredentials;
  receiptPath: string;
  ttlSeconds: number;
  environment?: Readonly<Record<string, string | undefined>>;
};

export type R2CredentialBrokerDependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
  randomSuffix?: () => string;
  runProcess: BrokerProcessRunner;
};

export type R2CredentialRecoveryInput = Pick<
  R2CredentialBrokerInput,
  "accountId" | "helperCommand" | "parentCredentials" | "receiptPath"
> & {
  guardCommand?: string;
  guardArguments?: readonly string[];
  environment?: Readonly<Record<string, string | undefined>>;
};
