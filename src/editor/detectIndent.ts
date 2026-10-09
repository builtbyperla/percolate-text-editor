
// Clamp for a detected space step: below 2 is unlikely to be intentional, above
// 8 is almost certainly a false read (e.g. a hanging continuation line).
const MIN_SPACE_UNIT = 2;
const MAX_SPACE_UNIT = 8;

export function detectIndentUnit(text: string, fallback: string = '    '): string {
    let smallestSpaceIndent: number | null = null;

    for (const line of text.split('\n')) {
        // A leading tab settles it immediately — this is a tab-indented file.
        if (line[0] === '\t') {
            return '\t';
        }
        // Count leading spaces; a line with none (or only spaces) tells us nothing.
        let spaces = 0;
        while (line[spaces] === ' ') {
            spaces++;
        }
        if (spaces === 0 || spaces === line.length) {
            continue;
        }
        if (smallestSpaceIndent === null || spaces < smallestSpaceIndent) {
            smallestSpaceIndent = spaces;
        }
    }

    if (smallestSpaceIndent === null) {
        return fallback;
    }
    const unit = Math.min(Math.max(smallestSpaceIndent, MIN_SPACE_UNIT), MAX_SPACE_UNIT);
    return ' '.repeat(unit);
}
