import countries from "@/data/form-countries.json";

export const internationalContactCountries = countries;
export const internationalDialCodes = [...new Set(countries.map(country => country.dialCode))];
const knownDialCodes = new Set(internationalDialCodes);
export type InternationalContactParts = { dialCode: string; number: string; countryCode: string; countryCodes: string[] };
export function internationalContactDialCode(countryOrDialCode: string): string | undefined {
  return knownDialCodes.has(countryOrDialCode) ? countryOrDialCode : countries.find(country => country.iso === countryOrDialCode)?.dialCode;
}
export function parseInternationalContact(value: string): InternationalContactParts {
  const match = /^(\+\d+)(?: (.*))?$/.exec(value), dialCode = match?.[1] ?? "", number = match ? match[2] ?? "" : value;
  const countryCodes = countries.filter(country => country.dialCode === dialCode).map(country => country.iso);
  // +1 and +7 identify multiple countries. Keep their dial code and never guess an ISO.
  return { dialCode, number, countryCodes, countryCode: countryCodes.length === 1 ? countryCodes[0] : "" };
}
export function serializeInternationalContact(countryOrDialCode: string, number: string): string {
  const dialCode = internationalContactDialCode(countryOrDialCode) ?? countryOrDialCode;
  // Preserve partial candidates so required/hidden/dirty validation cannot mistake them for an empty answer.
  return dialCode ? dialCode + " " + number : number;
}
export function internationalContactError(value: string, required = false): string | undefined {
  if (!value.trim()) return required ? "국가 번호와 연락처를 입력해주세요." : undefined;
  const match = /^(\+\d+) ([0-9]{6,15})$/.exec(value.trim());
  if (!match || !knownDialCodes.has(match[1])) return "국가 번호와 6~15자리 숫자를 입력해주세요.";
}
