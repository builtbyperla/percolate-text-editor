export function nextForkDisplayName(sourceName: string, existingNames: Iterable<string>): string {
    const match = sourceName.match(/^(.*?)(?: \((\d+)\))?$/);
    const baseName = match?.[1]?.trim() || 'New session';
    const usedNames = new Set(existingNames);
    let counter = Math.max(2, Number(match?.[2] ?? 1) + 1);
    while (usedNames.has(`${baseName} (${counter})`)) counter += 1;
    return `${baseName} (${counter})`;
}

export function isUntitledSessionName(name: string): boolean {
    return /^New session(?: \(\d+\))?$/.test(name);
}

export function firstMessageDisplayName(message: string, existingNames: Iterable<string>, currentName = 'New session'): string | undefined {
    const normalized = message.replace(/\s+/g, ' ').trim();
    if (!normalized) return undefined;
    const baseName = normalized.length <= 60 ? normalized : `${normalized.slice(0, 59).trimEnd()}…`;
    const usedNames = new Set(existingNames);
    const forkNumber = currentName.match(/^New session \((\d+)\)$/)?.[1];
    if (forkNumber) {
        const numberedName = `${baseName} (${forkNumber})`;
        return usedNames.has(numberedName) ? nextForkDisplayName(numberedName, usedNames) : numberedName;
    }
    if (!usedNames.has(baseName)) return baseName;
    return nextForkDisplayName(baseName, usedNames);
}
