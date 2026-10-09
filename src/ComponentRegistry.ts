export type ComponentType = 'container' | 'text' | 'segment' | string;

export interface RegistryEntry {
    id: string;
    type: ComponentType;
    component: object;
}

export class ComponentRegistry {
    private entries: Map<string, RegistryEntry> = new Map();
    private parentMap: Map<string, string> = new Map();
    private childrenMap: Map<string, string[]> = new Map();

    register(component: object & { id: string }, type: ComponentType): void {
        this.entries.set(component.id, { id: component.id, type, component });
    }

    deregister(id: string): void {
        this.entries.delete(id);
        const parentId = this.parentMap.get(id);
        if (parentId) {
            const siblings = this.childrenMap.get(parentId) ?? [];
            this.childrenMap.set(parentId, siblings.filter(cid => cid !== id));
            this.parentMap.delete(id);
        }
        // Clean up as parent too
        this.childrenMap.delete(id);
    }

    setParent(childId: string, parentId: string): void {
        const prev = this.parentMap.get(childId);
        if (prev) {
            const siblings = this.childrenMap.get(prev) ?? [];
            this.childrenMap.set(prev, siblings.filter(cid => cid !== childId));
        }
        this.parentMap.set(childId, parentId);
        const children = this.childrenMap.get(parentId) ?? [];
        if (!children.includes(childId)) {
            this.childrenMap.set(parentId, [...children, childId]);
        }
    }

    get(id: string): RegistryEntry | undefined {
        return this.entries.get(id);
    }

    getParent(id: string): RegistryEntry | undefined {
        const parentId = this.parentMap.get(id);
        return parentId ? this.entries.get(parentId) : undefined;
    }

    getChildren(id: string): RegistryEntry[] {
        return (this.childrenMap.get(id) ?? [])
            .map(cid => this.entries.get(cid))
            .filter((e): e is RegistryEntry => e !== undefined);
    }

    isSiblings(idA: string, idB: string): boolean {
        const pA = this.parentMap.get(idA);
        const pB = this.parentMap.get(idB);
        return pA !== undefined && pA === pB;
    }

    getAncestors(id: string): RegistryEntry[] {
        const ancestors: RegistryEntry[] = [];
        let current = this.parentMap.get(id);
        while (current) {
            const entry = this.entries.get(current);
            if (!entry) break;
            ancestors.unshift(entry);
            current = this.parentMap.get(current);
        }
        return ancestors;
    }

    getFirstAncestorOfType(id: string, type: ComponentType): RegistryEntry | undefined {
        let current = this.parentMap.get(id);
        while (current) {
            const entry = this.entries.get(current);
            if (!entry) break;
            if (entry.type === type) return entry;
            current = this.parentMap.get(current);
        }
        return undefined;
    }

}

export const componentRegistry = new ComponentRegistry();
