import { contextRegistry } from './ContextRegistry';
import { EvidenceTree, type EvidenceGroup } from './EvidenceTree';
import { userSettings } from '../UserSettings';
import type { ContextItem } from '../annotation/ContextItem';
import type { EvidenceGroupSnapshot, EvidenceSnapshot } from '../chat/ChatBlockModel';

export interface PreparedSnapshot {
    groups: EvidenceGroupSnapshot[];
    consumed: ContextItem[];
}

// Per-item snapshot mapper. Was ChatFlow.snapshotItem; moved here so the chat
// layer no longer reaches into evidence knowledge to assemble a payload.
function snapshotItem(i: ContextItem): EvidenceSnapshot {
    const override = i.getFullSourceOverride();
    if (override) return {
        label: override.label,
        note: i.getNote(),
        type: i.getSourceType(),
        presentation: i.view.contextPresentation ?? 'text',
        additionalData: override.additionalData,
    };
    const model = i.view.getDataSource();
    const source = model.displayText();
    const range = i.getRange();
    const sourceLines = source.split('\n');
    const startLine = range ? model.lineAtOffset(range.start) : 1;
    const selectedEndLine = range ? model.lineAtOffset(Math.max(range.start, range.end - 1)) : undefined;
    const firstLine = range ? Math.max(1, startLine - 1) : 1;
    const lastLine = range ? Math.min(sourceLines.length, Math.max(selectedEndLine ?? startLine, startLine) + 1, firstLine + 7) : Math.min(sourceLines.length, 3);
    return {
        label: i.getPreviewText(),
        note: i.getNote(),
        type: i.getSourceType(),
        presentation: i.view.contextPresentation ?? 'text',
        preview: {
            startLine: firstLine,
            lines: sourceLines.slice(firstLine - 1, lastLine).map(line => line.replace(/\r$/, '')),
            selectedStartLine: range ? startLine : undefined,
            selectedEndLine,
        },
        // Only present when the origin attaches richer data (e.g. a diff's before/after).
        additionalData: i.additionalData(),
    };
}

function parentShips(parent: ContextItem, hasIncludedSlice: boolean): boolean {
    return contextRegistry.items().includes(parent)
        ? parent.getIncluded()
        : hasIncludedSlice && userSettings.evidence.includeFullSource();
}

export function createSingleSnapshot(item: ContextItem, evidenceGroups: readonly EvidenceGroup[] = []): PreparedSnapshot {
    const group = evidenceGroups.find(candidate => candidate.key === item.groupKey())
        ?? new EvidenceTree().group([item])[0];
    const parent = item.isWholeSource() ? null : group?.parent;
    const included = [
        ...(parent && parentShips(parent, true) ? [parent] : []),
        item,
    ];
    return {
        groups: [{
            sourceId: item.groupKey(),
            label: item.groupLabel(),
            items: included.map(snapshotItem),
        }],
        consumed: included.filter(candidate => contextRegistry.items().includes(candidate)),
    };
}

export function prepareEvidenceSnapshot(evidenceGroups: readonly EvidenceGroup[]): PreparedSnapshot {
    const consumed: ContextItem[] = [];
    const groups: EvidenceGroupSnapshot[] = [];

    for (const g of evidenceGroups) {
        const slices = g.items.filter(i => i.getIncluded());
        const included = [
            ...(g.parent && parentShips(g.parent, slices.length > 0) ? [g.parent] : []),
            ...slices,
        ];
        if (included.length === 0) continue;

        groups.push({
            sourceId: g.key,
            label: g.label,
            items: included.map(snapshotItem),
        });
        // Only real registry items have a highlight to clear; a derived virtual
        // parent isn't registered, so it isn't consumed.
        for (const item of included) {
            if (contextRegistry.items().includes(item)) consumed.push(item);
        }
    }

    return { groups, consumed };
}
