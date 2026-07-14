interface DatabaseErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Turn Supabase/PostgREST save failures into useful, bounded UI copy without
 * echoing arbitrary database detail. PGRST204 is safe to specialize because
 * its contract is specifically "requested column not found".
 */
export function projectSaveErrorMessage(error: DatabaseErrorLike): string {
  const code = typeof error.code === "string" ? error.code : "";
  if (code === "PGRST204") {
    const column = error.message?.match(/['"]([a-z_][a-z0-9_]*)['"]\s+column/i)?.[1];
    return column
      ? `Database schema is missing “${column}” (PGRST204). Run the latest Supabase migration.`
      : "Database schema is missing a project column (PGRST204). Run the latest Supabase migration.";
  }
  return `Project save failed${code ? ` (${code})` : ""}. Try Save now again.`;
}
