export interface CodeLine {
  text: string;
  start: number;
}
export interface CodeMatch {
  start: number;
  end: number;
}

/** Keeps every original line ending; joining the lines reconstructs the stored SQL exactly. */
export function codeLines(text: string): CodeLine[] {
  const lines: CodeLine[] = [];
  let start = 0;
  for (const ending of text.matchAll(/\r\n|\r|\n/gu)) {
    const end = ending.index + ending[0].length;
    lines.push({ text: text.slice(start, end), start });
    start = end;
  }
  lines.push({ text: text.slice(start), start });
  return lines;
}

/** Literal, case-insensitive matches; offsets always refer to the original UTF-16 text. */
export function codeMatches(text: string, query: string): CodeMatch[] {
  if (query === "") return [];
  const literal = query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [...text.matchAll(new RegExp(literal, "giu"))].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function nextCodeMatch(current: number, count: number, backwards: boolean): number {
  return count === 0 ? 0 : (current + (backwards ? -1 : 1) + count) % count;
}

/** Locate a range endpoint without scanning every preceding line for every match. */
export function codePosition(
  lines: readonly CodeLine[],
  offset: number,
): { line: number; offset: number } {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lines[middle]?.start ?? Infinity) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low, offset: offset - (lines[low]?.start ?? 0) };
}
