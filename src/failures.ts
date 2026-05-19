export function formatVenueFailure(venue: string, reason: unknown): string {
  if (reason instanceof Error) return `${venue}: ${reason.name}: ${reason.message}`;
  return `${venue}: ${String(reason)}`;
}
