// SPDX-License-Identifier: Apache-2.0

/** Uses an explicit label or derives one from the section slug. */
export function chapterLabel(slug: string, override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

/** Evenly spaced chapter position on the rail, from 0 to 1. */
export function railPosition(index: number, count: number): number {
  if (count <= 1) return 0;
  return index / (count - 1);
}
