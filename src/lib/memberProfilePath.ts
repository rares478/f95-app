export function memberProfilePath(userId: string | null | undefined): string | null {
  const id = userId?.trim() ?? '';
  if (!id || !/^\d+$/.test(id)) return null;
  return `/members/${id}`;
}
