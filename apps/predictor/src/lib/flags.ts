/**
 * Map F1 country names (as Jolpica/Ergast spells them) to ISO 3166-1 alpha-2
 * codes for free flagcdn.com images. Unknown → null (UI omits the flag).
 * App-local presentation helper (Constitution III scopes sharing to
 * schemas/keys/cross-cutting data, not per-app flag mapping).
 */

const COUNTRY: Record<string, string> = {
  australia: "au",
  austria: "at",
  azerbaijan: "az",
  bahrain: "bh",
  belgium: "be",
  brazil: "br",
  canada: "ca",
  china: "cn",
  france: "fr",
  germany: "de",
  "great britain": "gb",
  uk: "gb",
  "united kingdom": "gb",
  hungary: "hu",
  india: "in",
  italy: "it",
  japan: "jp",
  korea: "kr",
  malaysia: "my",
  mexico: "mx",
  monaco: "mc",
  netherlands: "nl",
  portugal: "pt",
  qatar: "qa",
  russia: "ru",
  "saudi arabia": "sa",
  singapore: "sg",
  "south africa": "za",
  spain: "es",
  sweden: "se",
  switzerland: "ch",
  turkey: "tr",
  uae: "ae",
  "united arab emirates": "ae",
  usa: "us",
  "united states": "us",
};

export function countryToCode(name: string | undefined): string | null {
  if (!name) return null;
  return COUNTRY[name.trim().toLowerCase()] ?? null;
}
