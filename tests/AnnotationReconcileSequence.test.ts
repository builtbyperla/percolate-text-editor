import { describe, it, expect } from 'vitest';
import { EditorState, ChangeSet } from '@codemirror/state';
import { CmTextDataModel } from '../src/textmodel/TextDataModel';
import type { AnchorRange } from '../src/textmodel/AnnotationAnchors';

// Tier-1: SEQUENTIAL edit reconciliation. AnnotationAnchors.test covers one change
// against a pristine doc; this covers the loop the editor actually runs — type a
// character, map, write survivors back, re-seed from those survivors, repeat.
//
// The invariant under test is the one loadFromContext enforces (TextViewCore): after
// every edit the tracked ranges must be in-bounds, non-overlapping, and ascending.
// A range that outruns the doc gets reported invalid and the highlight is SKIPPED,
// so a violation here is a highlight disappearing in the app.

// Mirror of CmEditorFrame.reconcileAnnotations: seed from current truth, map, then
// write survivors back as the new truth. `items` stands in for the registry.
function reconcile(model: CmTextDataModel, items: AnchorRange[], changes: ChangeSet) {
    model.setAnnotationRanges(items);
    const { survivors, dropped } = model.mapAnnotations(changes);
    const byId = new Map(survivors.map(s => [s.id, s]));
    const next = items
        .filter(it => !dropped.includes(it.id))
        .map(it => byId.get(it.id) ?? it);
    model.applyChanges(changes);
    return next;
}

// The three conditions loadFromContext rejects, checked against the live doc.
function assertLoadable(doc: string, items: AnchorRange[]) {
    const sorted = [...items].sort((a, b) => a.from - b.from);
    let cursor = 0;
    for (const r of sorted) {
        expect(r.from >= r.to, `collapsed: ${r.id} [${r.from},${r.to})`).toBe(false);
        expect(r.to > doc.length, `past-eof: ${r.id} [${r.from},${r.to}) len ${doc.length}`).toBe(false);
        expect(r.from < cursor, `overlap: ${r.id} starts ${r.from} < cursor ${cursor}`).toBe(false);
        cursor = r.to;
    }
}

describe('sequential edits keep annotation ranges loadable', () => {
    const DOC = [
        'function alpha() {',
        '    return beta + gamma;',
        '}',
        '',
        'const delta = epsilon(zeta);',
    ].join('\n');

    // Two non-overlapping highlights, like a few annotations in the sample editor.
    function seed(doc: string): AnchorRange[] {
        const b = doc.indexOf('beta');
        const e = doc.indexOf('epsilon');
        return [
            { id: 'h1', from: b, to: b + 'beta'.length },
            { id: 'h2', from: e, to: e + 'epsilon'.length },
        ];
    }

    it('stays loadable while typing characters at the top', () => {
        let doc = DOC;
        let items = seed(doc);
        for (let i = 0; i < 40; i++) {
            const changes = ChangeSet.of({ from: 0, insert: 'x' }, doc.length);
            items = reconcile(new CmTextDataModel(doc), items, changes);
            doc = changes.apply(EditorState.create({ doc }).doc).toString();
            assertLoadable(doc, items);
        }
    });

    it('stays loadable while typing newlines at the top', () => {
        let doc = DOC;
        let items = seed(doc);
        for (let i = 0; i < 40; i++) {
            const changes = ChangeSet.of({ from: 0, insert: '\n' }, doc.length);
            items = reconcile(new CmTextDataModel(doc), items, changes);
            doc = changes.apply(EditorState.create({ doc }).doc).toString();
            assertLoadable(doc, items);
        }
    });

    it('stays loadable while typing inside a highlight', () => {
        let doc = DOC;
        let items = seed(doc);
        for (let i = 0; i < 40; i++) {
            const at = items[0].from + 1; // inside h1
            const changes = ChangeSet.of({ from: at, insert: 'q' }, doc.length);
            items = reconcile(new CmTextDataModel(doc), items, changes);
            doc = changes.apply(EditorState.create({ doc }).doc).toString();
            assertLoadable(doc, items);
        }
    });

    // Deleting shortens the doc — the case that produced `range past length` in the app.
    it('stays loadable while deleting text before the highlights', () => {
        let doc = DOC;
        let items = seed(doc);
        for (let i = 0; i < 10; i++) {
            const changes = ChangeSet.of({ from: 0, to: 1, insert: '' }, doc.length);
            items = reconcile(new CmTextDataModel(doc), items, changes);
            doc = changes.apply(EditorState.create({ doc }).doc).toString();
            assertLoadable(doc, items);
        }
    });

    // Mixed insert/delete, the closest analogue to "typed a lot of characters".
    it('stays loadable under a mixed insert/delete sequence', () => {
        let doc = DOC;
        let items = seed(doc);
        for (let i = 0; i < 60; i++) {
            const insert = i % 3 === 0;
            const at = i % 7;
            const changes = insert
                ? ChangeSet.of({ from: at, insert: i % 2 ? '\n' : 'z' }, doc.length)
                : ChangeSet.of({ from: at, to: at + 1, insert: '' }, doc.length);
            items = reconcile(new CmTextDataModel(doc), items, changes);
            doc = changes.apply(EditorState.create({ doc }).doc).toString();
            assertLoadable(doc, items);
        }
    });
});
