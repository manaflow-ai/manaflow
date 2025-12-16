const PATH_SEPARATORS = new Set(["/", "\\"]);
const WORD_SEPARATORS = new Set(["_", "-", ".", " ", "'", '"', ":"]);
const isAscii = (char: string) => char.length === 1 && char.charCodeAt(0) <= 0x7f;

const toLower = (char: string) => char.toLocaleLowerCase("en-US");
const toUpper = (char: string) => char.toLocaleUpperCase("en-US");

const charMatches = (queryChar: string, targetChar: string): boolean => {
  if (queryChar === "/") {
    return targetChar === "/" || targetChar === "\\";
  }
  if (queryChar === "\\") {
    return targetChar === "/" || targetChar === "\\";
  }
  if (queryChar === targetChar) {
    return true;
  }
  if (isAscii(queryChar) && isAscii(targetChar)) {
    return queryChar.toLowerCase() === targetChar.toLowerCase();
  }
  return toLower(queryChar) === toLower(targetChar);
};

const isPathSeparator = (char: string) => PATH_SEPARATORS.has(char);
const isWordSeparator = (char: string) => WORD_SEPARATORS.has(char);

const isUpperCaseChar = (char: string) => {
  if (!char) return false;
  if (isAscii(char)) {
    const code = char.charCodeAt(0);
    return code >= 65 && code <= 90;
  }
  const upper = toUpper(char);
  const lower = toLower(char);
  return char === upper && char !== lower;
};

const ensureSize = (buffer: number[], size: number) => {
  if (buffer.length !== size) {
    buffer.length = size;
  }
};

export class VscodeFuzzyMatcher {
  private targetChars: string[] = [];
  private firstPossibleMatch: number[] = [];
  private prevSeqMatchCounts: number[] = [];
  private prevScore: number[] = [];
  private seqMatchCounts: number[] = [];
  private score: number[] = [];

  fuzzyMatch(target: string, query: string): number | null {
    if (!target || !query) {
      return null;
    }

    this.targetChars = Array.from(target);
    const targetLength = this.targetChars.length;
    if (targetLength === 0) {
      return null;
    }

    const queryChars = Array.from(query);
    const queryLength = queryChars.length;
    if (queryLength === 0) {
      return null;
    }

    this.firstPossibleMatch = [];
    let queryIndex = 0;
    for (let targetIdx = 0; targetIdx < targetLength && queryIndex < queryLength; targetIdx += 1) {
      if (charMatches(queryChars[queryIndex], this.targetChars[targetIdx])) {
        this.firstPossibleMatch.push(targetIdx);
        queryIndex += 1;
      }
    }

    if (queryIndex < queryLength) {
      return null;
    }

    ensureSize(this.prevSeqMatchCounts, targetLength);
    this.prevSeqMatchCounts.fill(0);
    ensureSize(this.prevScore, targetLength);
    this.prevScore.fill(0);
    ensureSize(this.seqMatchCounts, targetLength);
    this.seqMatchCounts.fill(0);
    ensureSize(this.score, targetLength);
    this.score.fill(0);

    let firstPossibleTargetIdx = 0;
    let firstQueryChar = true;

    for (let queryIdx = 0; queryIdx < queryLength; queryIdx += 1) {
      const queryChar = queryChars[queryIdx];
      const firstPossibleMatch = this.firstPossibleMatch[queryIdx];

      if (firstPossibleTargetIdx >= targetLength) {
        return null;
      }

      firstPossibleTargetIdx = Math.max(firstPossibleTargetIdx, firstPossibleMatch);
      this.seqMatchCounts.fill(0, firstPossibleTargetIdx);
      this.score.fill(0, firstPossibleTargetIdx);

      let firstNonZeroScore: number | null = null;

      for (let i = firstPossibleTargetIdx; i < targetLength; i += 1) {
        const targetChar = this.targetChars[i];
        const prevTargetScore = i === firstPossibleTargetIdx ? 0 : this.score[i - 1];
        const prevQueryScore = i === 0 ? 0 : this.prevScore[i - 1];
        const seqMatchCount = i === 0 ? 0 : this.prevSeqMatchCounts[i - 1];

        if (!firstQueryChar && prevQueryScore === 0) {
          this.score[i] = prevTargetScore;
          continue;
        }

        if (!charMatches(queryChar, targetChar)) {
          this.score[i] = prevTargetScore;
          continue;
        }

        let charScore = 1;
        charScore += seqMatchCount * 5;

        if (targetChar === queryChar) {
          charScore += 1;
        }

        if (i === 0) {
          charScore += 8;
        } else if (isPathSeparator(targetChar)) {
          charScore += 5;
        } else if (isWordSeparator(targetChar)) {
          charScore += 4;
        } else if (seqMatchCount === 0) {
          const prevChar = this.targetChars[i - 1];
          if (isWordSeparator(prevChar)) {
            charScore += 2;
          } else if (isUpperCaseChar(targetChar)) {
            charScore += 2;
          }
        }

        if (i + 1 === targetLength) {
          charScore += 2;
        }

        const newScore = prevQueryScore + charScore;
        if (newScore >= prevTargetScore) {
          this.score[i] = newScore;
          this.seqMatchCounts[i] = seqMatchCount + 1;
          if (firstNonZeroScore === null) {
            firstNonZeroScore = i;
          }
        } else {
          this.score[i] = prevTargetScore;
        }
      }

      if (firstNonZeroScore === null) {
        return null;
      }

      firstPossibleTargetIdx = firstNonZeroScore + 1;
      for (let i = firstNonZeroScore; i < targetLength; i += 1) {
        this.prevScore[i] = this.score[i];
        this.prevSeqMatchCounts[i] = this.seqMatchCounts[i];
      }
      firstQueryChar = false;
    }

    const finalScore = targetLength === 0 ? 0 : this.prevScore[targetLength - 1] ?? 0;
    return finalScore === 0 ? null : finalScore;
  }
}

const sharedMatcher = new VscodeFuzzyMatcher();

export const fuzzyMatch = (target: string, query: string): number | null =>
  sharedMatcher.fuzzyMatch(target, query);
