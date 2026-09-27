import type { Db } from "recipe-db";

export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
