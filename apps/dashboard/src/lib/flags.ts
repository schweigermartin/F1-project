/**
 * Map F1 country names + nationalities (as the Jolpica/Ergast API spells them)
 * to ISO 3166-1 alpha-2 codes, for flag images from flagcdn.com (free, no key).
 * Unknown inputs return null so the UI just omits the flag (graceful).
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

const NATIONALITY: Record<string, string> = {
  american: "us",
  argentine: "ar",
  argentinian: "ar",
  australian: "au",
  austrian: "at",
  belgian: "be",
  brazilian: "br",
  british: "gb",
  canadian: "ca",
  chinese: "cn",
  danish: "dk",
  dutch: "nl",
  finnish: "fi",
  french: "fr",
  german: "de",
  indian: "in",
  italian: "it",
  japanese: "jp",
  mexican: "mx",
  monegasque: "mc",
  "new zealander": "nz",
  polish: "pl",
  portuguese: "pt",
  russian: "ru",
  spanish: "es",
  swedish: "se",
  swiss: "ch",
  thai: "th",
  turkish: "tr",
};

export function countryToCode(name: string | undefined): string | null {
  if (!name) return null;
  return COUNTRY[name.trim().toLowerCase()] ?? null;
}

export function nationalityToCode(nat: string | undefined): string | null {
  if (!nat) return null;
  return NATIONALITY[nat.trim().toLowerCase()] ?? null;
}
