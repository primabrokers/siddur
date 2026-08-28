/**
 * Supabase types — INTENTIONALLY `any` while feature agents are mid-build.
 *
 * The real generated types live in `database.types.generated.ts` (from the
 * live schema at migrations 001–005b). Adopting them strictly surfaces ~44
 * errors across the query layer; that adoption happens as one dedicated
 * integration pass AFTER migrations 006–010 land, when the file is
 * regenerated and swapped in here.
 */
export type Database = any
