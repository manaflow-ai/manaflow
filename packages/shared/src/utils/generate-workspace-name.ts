const ALPHABET_SIZE = 26;
const FIRST_LETTER_CHAR_CODE = "a".charCodeAt(0);

export function workspaceSequenceToName(sequence: number): string {
  if (sequence < 0) {
    throw new Error("Workspace sequence cannot be negative");
  }

  let value = sequence;
  let result = "";

  while (value >= 0) {
    const remainder = value % ALPHABET_SIZE;
    const char = String.fromCharCode(FIRST_LETTER_CHAR_CODE + remainder);
    result = char + result;
    value = Math.floor(value / ALPHABET_SIZE) - 1;
  }

  return result;
}
