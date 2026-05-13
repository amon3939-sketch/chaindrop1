/**
 * Short, URL-safe identifiers used as roomId / joinCode values.
 *
 * The alphabet excludes visually ambiguous characters (no 0/O, no 1/l)
 * so they survive being read aloud or typed by hand without errors.
 */

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function randomId(prefix: string, length = 6): string {
  let out = prefix;
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * ALPHABET.length);
    out += ALPHABET[idx];
  }
  return out;
}

export function randomJoinCode(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * ALPHABET.length);
    out += ALPHABET[idx];
  }
  return out;
}
