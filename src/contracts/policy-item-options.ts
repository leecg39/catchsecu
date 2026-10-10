import type { PolicyItemOptions } from "./document-policy";

export const policyItemKey = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");

// Each category is deduplicated separately: a purpose may make another purpose's optional item required.
export function policyItemOptions(purposes: { items: { name: string; required: boolean }[] }[]): PolicyItemOptions {
  const required = new Map<string, string>(), optional = new Map<string, string>();
  for (const purpose of purposes) for (const item of purpose.items) {
    const name = item.name.trim(), target = item.required ? required : optional, key = policyItemKey(name);
    if (key && !target.has(key)) target.set(key, name);
  }
  return { requiredItems: [...required.values()], optionalItems: [...optional.values()] };
}
