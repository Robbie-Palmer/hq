import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), ".agent-auth");
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(data, secret) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    deriveKey(secret),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );
  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

function decrypt(encoded, secret) {
  const buffer = Buffer.from(encoded, "base64url");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    deriveKey(secret),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export class FileStorage {
  constructor(directory, encryptionKey) {
    this.directory = directory ?? DEFAULT_STORAGE_DIR;
    this.encryptionKey =
      encryptionKey ?? process.env.AGENT_AUTH_ENCRYPTION_KEY ?? null;

    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
    for (const child of ["agents", "providers"]) {
      const childDirectory = path.join(this.directory, child);
      fs.mkdirSync(childDirectory, { recursive: true, mode: 0o700 });
      fs.chmodSync(childDirectory, 0o700);
    }

    if (!this.encryptionKey) {
      process.stderr.write(
        "[agent-auth] WARNING: Private keys will be stored unencrypted. " +
          "Set AGENT_AUTH_ENCRYPTION_KEY.\n",
      );
    }
  }

  encode(value) {
    return encodeURIComponent(value).replaceAll("%", "_");
  }

  readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  writeJson(filePath, data, secret = false) {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), {
        encoding: "utf8",
        mode: secret ? 0o600 : undefined,
      });
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      this.deleteFile(temporaryPath);
      throw error;
    }
  }

  deleteFile(filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Deleting an already absent connection is idempotent.
    }
  }

  listJson(directory) {
    try {
      return fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
  }

  encryptKeypair(keypair) {
    if (!this.encryptionKey) return keypair;
    return {
      __encrypted: encrypt(JSON.stringify(keypair), this.encryptionKey),
    };
  }

  decryptKeypair(stored) {
    if (stored && typeof stored === "object" && "__encrypted" in stored) {
      if (!this.encryptionKey) {
        throw new Error(
          "Private key is encrypted but AGENT_AUTH_ENCRYPTION_KEY is not set.",
        );
      }
      return JSON.parse(decrypt(stored.__encrypted, this.encryptionKey));
    }
    return stored;
  }

  get hostPath() {
    return path.join(this.directory, "host.json");
  }

  async getHostIdentity() {
    const stored = this.readJson(this.hostPath);
    return stored
      ? { ...stored, keypair: this.decryptKeypair(stored.keypair) }
      : null;
  }

  async setHostIdentity(host) {
    this.writeJson(
      this.hostPath,
      { ...host, keypair: this.encryptKeypair(host.keypair) },
      true,
    );
  }

  async deleteHostIdentity() {
    this.deleteFile(this.hostPath);
  }

  async recoverUnreadableHostIdentity() {
    try {
      await this.getHostIdentity();
      return false;
    } catch {
      await this.deleteHostIdentity();
      return true;
    }
  }

  agentPath(agentId) {
    return path.join(this.directory, "agents", `${this.encode(agentId)}.json`);
  }

  async getAgentConnection(agentId) {
    const stored = this.readJson(this.agentPath(agentId));
    return stored
      ? {
          ...stored,
          agentKeypair: this.decryptKeypair(stored.agentKeypair),
        }
      : null;
  }

  async setAgentConnection(agentId, connection) {
    this.writeJson(
      this.agentPath(agentId),
      {
        ...connection,
        agentKeypair: this.encryptKeypair(connection.agentKeypair),
      },
      true,
    );
  }

  async deleteAgentConnection(agentId) {
    this.deleteFile(this.agentPath(agentId));
  }

  async listAgentConnections() {
    const directory = path.join(this.directory, "agents");
    return this.listJson(directory)
      .map((name) => this.readJson(path.join(directory, name)))
      .filter(Boolean)
      .flatMap((stored) => {
        try {
          return [
            {
              ...stored,
              agentKeypair: this.decryptKeypair(stored.agentKeypair),
            },
          ];
        } catch {
          return [];
        }
      });
  }

  providerPath(issuer) {
    return path.join(
      this.directory,
      "providers",
      `${this.encode(issuer)}.json`,
    );
  }

  async getProviderConfig(issuer) {
    return this.readJson(this.providerPath(issuer));
  }

  async setProviderConfig(issuer, config) {
    this.writeJson(this.providerPath(issuer), config);
  }

  async listProviderConfigs() {
    const directory = path.join(this.directory, "providers");
    return this.listJson(directory)
      .map((name) => this.readJson(path.join(directory, name)))
      .filter(Boolean);
  }
}
