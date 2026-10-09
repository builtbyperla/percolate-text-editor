import { describe, expect, it } from 'vitest';
import { NonDataSource, SourceId, deriveFileLabel } from '../src/textmodel/SourceId';

describe('SourceId', () => {
    it('gives non-data views a stable, namespaced identity', () => {
        const context = new NonDataSource('agent-tools', 'context', 'Context');
        const otherContext = new NonDataSource('other-tools', 'context', 'Context');

        expect(context.kind()).toBe('view');
        expect(context.full()).toBe('view:agent-tools/context');
        expect(context.label()).toBe('Context');
        expect(context.equals(otherContext)).toBe(false);
    });

    it('full() namespaces by kind so identical locals across kinds do not alias', () => {
        const a = new SourceId('file', 'basic-editor');
        const b = new SourceId('scratch', 'basic-editor');
        expect(a.full()).toBe('file:basic-editor');
        expect(b.full()).toBe('scratch:basic-editor');
        expect(a.full()).not.toBe(b.full());
    });

    it('equals() is value-based across separately constructed instances', () => {
        const a = new SourceId('file', '/tmp/a.ts');
        const b = new SourceId('file', '/tmp/a.ts');
        expect(a).not.toBe(b);
        expect(a.equals(b)).toBe(true);
    });

    it('label() derives a file basename, honors override, falls back to local for non-file', () => {
        expect(new SourceId('file', '/tmp/foo.ts').label()).toBe('foo.ts');
        expect(new SourceId('file', 'inmemory:/README.md').label()).toBe('README.md');
        expect(new SourceId('file', 'inmemory:/').label()).toBe('/');
        expect(new SourceId('file', '/tmp/foo.ts', 'renamed').label()).toBe('renamed');
        expect(new SourceId('scratch', 'basic-editor').label()).toBe('basic-editor');
        expect(new SourceId('terminal', '1', 'Terminal 1').label()).toBe('Terminal 1');
    });
});

describe('deriveFileLabel', () => {
    it('strips scheme and trailing slash', () => {
        expect(deriveFileLabel('inmemory:/src/main.ts')).toBe('main.ts');
        expect(deriveFileLabel('/absolute/path/')).toBe('path');
    });

    it('maps roots to /', () => {
        expect(deriveFileLabel('/')).toBe('/');
        expect(deriveFileLabel('')).toBe('/');
        expect(deriveFileLabel('inmemory:/')).toBe('/');
    });
});
