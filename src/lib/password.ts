import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt from node:crypto: no native dependency to build in the Docker image.
// Parameters follow the OWASP recommendation (N=2^17, r=8, p=1, 64-byte key).
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const FORMAT = "scrypt";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Passwords must not exceed ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/\S/.test(password)) return "Passwords cannot be blank.";
  return null;
}

function derive(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N, r, p, maxmem: 256 * N * r * 2 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** Returns `scrypt$N$r$p$<salt b64url>$<key b64url>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    FORMAT,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every((value) => Number.isSafeInteger(value) && value > 0)) {
    return false;
  }
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(password, salt, N, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const TEMPORARY_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** Human-readable temporary password without ambiguous characters. */
export function generateTemporaryPassword(length = 16): string {
  const bytes = randomBytes(length);
  let result = "";
  for (const byte of bytes) {
    result += TEMPORARY_PASSWORD_ALPHABET[byte % TEMPORARY_PASSWORD_ALPHABET.length];
  }
  return result;
}
