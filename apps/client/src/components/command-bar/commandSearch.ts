import { fuzzyMatch } from "@/lib/vscodeFuzzyMatch";

export interface SearchableCommandItem {
  value: string;
  searchText: string;
}

export const buildSearchText = (
  label: string,
  keywords: string[] = [],
  extras: Array<string | undefined> = [],
) =>
  [label, ...keywords, ...extras.filter((value): value is string => Boolean(value))]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");

export const filterCommandItems = <T extends SearchableCommandItem>(
  query: string,
  items: T[],
) => {
  const trimmed = query.trim();
  if (!trimmed) {
    return items;
  }

  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = fuzzyMatch(item.searchText, trimmed);
    if (score !== null) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
};
