import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { ContextItem, type ContextView } from '../src/annotation/ContextItem';
import { EvidencePane } from '../src/featurepanes/EvidenceBlock';
import { contextRegistry } from '../src/interactions/ContextRegistry';
import { sourceContextRegistry } from '../src/interactions/SourceContextRegistry';
import { registrySources } from '../src/interactions/RegistrySources';
import { FixedTextDataModel } from '../src/textmodel/FixedTextDataModel';

function addSlice(sourceId: string, start: number, end: number): ContextItem {
    const model = new FixedTextDataModel('alpha beta gamma');
    const view: ContextView = {
        sourceId,
        label: sourceId,
        getDataSource: () => model,
        scrollToItem: () => {},
        getSubViews: () => [],
    };
    const item = new ContextItem(view);
    item.setRange(start, end);
    sourceContextRegistry.add(item);
    return item;
}

afterEach(() => {
    cleanup();
    for (const item of [...contextRegistry.items()]) sourceContextRegistry.remove(item);
});

describe('EvidencePane delete selected', () => {
    it('removes only included items from the pane and source views', () => {
        const selected = addSlice('source-a', 0, 5);
        const excluded = addSlice('source-a', 6, 10);
        const otherSource = addSlice('source-b', 0, 5);
        excluded.setIncluded(false);
        otherSource.setIncluded(false);

        const onSourceContextItemsChange = vi.fn();
        const listener = { onSourceContextItemsChange };
        registrySources.register('source-a', listener);

        const pane = new EvidencePane();
        const mounted = render(() => pane.getVisual()());
        const button = mounted.getByRole('button', { name: 'Delete selected context items' });
        expect(button).not.toBeDisabled();

        fireEvent.click(button);

        expect(contextRegistry.items()).toEqual([excluded, otherSource]);
        expect(sourceContextRegistry.itemsFor('source-a')).toEqual([excluded]);
        expect(sourceContextRegistry.itemsFor('source-b')).toEqual([otherSource]);
        expect(onSourceContextItemsChange).toHaveBeenCalledWith([excluded]);
        expect(button).toBeDisabled();
        registrySources.deregister('source-a', listener);
    });

    it('clears a directly registered whole-source selection', () => {
        const model = new FixedTextDataModel('whole source');
        const clear = vi.fn();
        const view: ContextView & { clear: () => void } = {
            sourceId: 'whole-source',
            label: 'Whole source',
            getDataSource: () => model,
            scrollToItem: () => {},
            getSubViews: () => [],
            clear,
        };
        const item = new ContextItem(view);
        clear.mockImplementation(() => item.deregister());
        item.register();

        const mounted = render(() => new EvidencePane().getVisual()());
        fireEvent.click(mounted.getByRole('button', { name: 'Delete selected context items' }));

        expect(clear).toHaveBeenCalledOnce();
        expect(contextRegistry.items()).not.toContain(item);
    });
});
