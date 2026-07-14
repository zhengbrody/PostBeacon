/**
 * Any signed-in identity arriving or leaving is a hard client-data boundary.
 * This intentionally gives up automatic anonymous-draft migration: a browser
 * draft must never be assumed to belong to the next account on a shared device.
 */
export function shouldResetForAccountBoundary(
  previousUserId: string | null | undefined,
  nextUserId: string | null
): boolean {
  if (previousUserId === nextUserId) return false;
  return previousUserId !== undefined || nextUserId !== null;
}
