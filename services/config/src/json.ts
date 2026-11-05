/** Minimal JSON value type for everything the workflow config can hold. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export function isJsonObject(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
