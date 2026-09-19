import { randomBytes, randomInt, createHash } from 'crypto';

const LOWER = 'abcdefghijkmnopqrstuvwxyz'; // no 'l'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 'I', 'O'
const DIGITS = '23456789'; // no '0', '1'
const SYMBOLS = '!@#$%^&*-_+=?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/**
 * A one-time initial/reset password, shown exactly once and never stored in
 * plain text anywhere. Guarantees at least one character from each class
 * (so it always looks obviously "generated", never a plausible dictionary
 * word) using `crypto.randomInt` for unbiased selection -- never
 * `Math.random()`, and never a fixed/predictable string like "DoctorPass123!".
 */
export function generateSecurePassword(length = 14): string {
  const required = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: length - required.length }, () => pick(ALL));
  return shuffle([...required, ...rest]).join('');
}

function pick(charset: string): string {
  return charset[randomInt(charset.length)];
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Raw forgot-password token -- exists only in the API response, never persisted. */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What actually gets stored, so a leaked database dump never reveals a usable token. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
