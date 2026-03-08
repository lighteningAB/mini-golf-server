import Filter from "bad-words";

// ----------------------------------------------------------------------------#
// Profanity Filter
// ----------------------------------------------------------------------------#
const filter = new Filter();

const MAX_NAME_LENGTH = 20;

export function censorName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!trimmed) return "Anonymous";
  return filter.clean(trimmed);
}
