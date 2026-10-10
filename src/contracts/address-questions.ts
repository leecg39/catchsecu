import { z } from "zod";
import countries from "@/data/form-countries.json";

const countryNames = new Map(countries.map(country => [country.iso, country.names.ko]));

export const foreignAddressFields = [
  { key: "streetAddress", label: "도로명 주소", maxLength: 255 },
  { key: "addressDetail", label: "상세 주소", maxLength: 255 },
  { key: "city", label: "도시", maxLength: 100 },
  { key: "state", label: "주/지역", maxLength: 100 },
  { key: "postalCode", label: "우편번호", maxLength: 20 },
] as const;

export const foreignAddressSchema = z.object({
  country: z.string().trim().refine(value => value === "" || countryNames.has(value), "목록에서 국가를 선택해주세요."),
  countryName: z.string().trim().max(100),
  streetAddress: z.string().trim().max(255),
  addressDetail: z.string().trim().max(255),
  city: z.string().trim().max(100),
  state: z.string().trim().max(100),
  postalCode: z.string().trim().max(20),
}).strict();
export type ForeignAddress = z.infer<typeof foreignAddressSchema>;

export function emptyForeignAddress(): ForeignAddress {
  return { country: "", countryName: "", streetAddress: "", addressDetail: "", city: "", state: "", postalCode: "" };
}

export function normalizeForeignAddress(value: unknown): ForeignAddress {
  if (value === undefined) return emptyForeignAddress();
  const address = foreignAddressSchema.parse(value);
  // Country labels are display metadata; the selected code determines the canonical Korean label.
  return { country: address.country, countryName: countryNames.get(address.country) ?? "",
    streetAddress: address.streetAddress, addressDetail: address.addressDetail,
    city: address.city, state: address.state, postalCode: address.postalCode };
}

export function foreignAddressError(value: ForeignAddress, required: boolean): string | undefined {
  const parsed = foreignAddressSchema.safeParse(value);
  if (!parsed.success) return "해외 주소의 국가, 필드 형식과 최대 글자 수를 확인해주세요.";
  const { country, streetAddress, city } = parsed.data;
  const count = [country, streetAddress, city].filter(Boolean).length;
  if ((required || count > 0) && count !== 3) return "국가, 도로명 주소, 도시를 모두 입력해주세요.";
}

export function formatForeignAddress(value: ForeignAddress): string {
  const address = normalizeForeignAddress(value);
  return [address.countryName ? "국가: " + address.countryName + " (" + address.country + ")" : "",
    ...foreignAddressFields.map(field => address[field.key] ? field.label + ": " + address[field.key] : "")].filter(Boolean).join(" / ") || "-";
}

export function serializeDomesticAddress(zipcode: string, address: string, detailAddress: string): string {
  const zip = zipcode.trim(), line = [address.trim(), detailAddress.trim()].filter(Boolean).join(" ");
  return zip || line ? ("(" + zip + ") " + line).trim() : "";
}

// These format/length limits are the local contract; original server validation was not observed.
export function domesticAddressError(value: string, required = false): string | undefined {
  const address = value.trim();
  if (!address) return required ? "주소를 입력해주세요." : undefined;
  if (address.length > 1000) return "주소는 1000자까지 입력할 수 있습니다.";
  if (!/^\(\d{5}\)\s+\S/.test(address)) return "5자리 우편번호와 주소를 입력해주세요.";
}
