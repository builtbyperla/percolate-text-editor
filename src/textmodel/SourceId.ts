
export type SourceKind = 'file' | 'scratch' | 'agent' | 'diff' | 'terminal' | 'view';

export class SourceId {
    constructor(
        private readonly _kind: SourceKind,
        private readonly _local: string,     // per-kind raw id (path, uuid, sample name, ...)
        private readonly _label?: string,    // explicit override; else derived
    ) {}

    kind(): SourceKind { return this._kind; }
    local(): string { return this._local; }

    // Collision-safe canonical key. Registries and Tab.id key on this string.
    full(): string { return `${this._kind}:${this._local}`; }

    equals(other: SourceId): boolean { return this.full() === other.full(); }

    // Human-facing display. Absorbs the old rootLabel regex's `/`-derivation
    // and the basename-of-a-path case. Explicit _label wins when provided.
    label(): string {
        if (this._label != null) return this._label;
        if (this._kind === 'file') return deriveFileLabel(this._local);
        return this._local;
    }
}

export class TemporarySource extends SourceId {
    constructor(label: string) {
        super('scratch', crypto.randomUUID(), label);
    }
}

// Stable identity for UI views that do not represent underlying data. The
// namespace keeps independently-authored view families collision-free without
// pretending their tabs are scratch documents.
export class NonDataSource extends SourceId {
    constructor(namespace: string, name: string, label: string = name) {
        super('view', `${namespace}/${name}`, label);
    }
}

export function deriveFileLabel(path: string): string {
    const stripped = path.replace(/^[a-z]+:/i, '');
    if (stripped === '/' || stripped === '') return '/';
    const trimmed = stripped.replace(/\/$/, '');
    const slash = trimmed.lastIndexOf('/');
    return slash < 0 ? trimmed : trimmed.slice(slash + 1) || '/';
}
