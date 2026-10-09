import { JSX } from 'solid-js';
import { ViewBlock, SubNode, TabHeader, TabDropArea } from '../../src/containers/Tabs';
import { FileSystemProvider, FsEntry, FsStat } from '../../src/fileexplorer/FileSystemProvider';

// A minimal ViewBlock for stuffing into Tabs/panes without rendering anything.
export class FakeViewBlock implements ViewBlock {
    ownsScroll = false;
    constructor(public label: string = 'fake') {}
    getVisual(): () => JSX.Element {
        return () => null;
    }
}

// A SubNode that records the calls a child makes back up to its parent, so a
// collapse path (child empties -> parent.removeNode(child)) can be asserted
// without a real pane tree.
export class FakeSubNode implements SubNode {
    ownsScroll = false;
    parent: SubNode | null = null;
    removed: SubNode[] = [];
    parentsSet: (SubNode | null)[] = [];

    getVisual(): () => JSX.Element {
        return () => null;
    }
    setParent(p: SubNode | null): void {
        this.parentsSet.push(p);
        this.parent = p;
    }
    removeNode(n: SubNode): void {
        this.removed.push(n);
    }
}

// The minimal slice of a TabHeader the drag manager touches: a tabBar reference
// (read into TabIntx) and a ghost-preview element. Cast to TabHeader at the seam.
export function fakeTabHeader(tabBar: unknown = {}): TabHeader {
    return {
        tabBar,
        getGhostPreview: () => {
            const el = document.createElement('div');
            el.textContent = 'ghost';
            return el;
        },
    } as unknown as TabHeader;
}

// A drop area that records the hover/drop calls routed to it, with a real DOM
// ref so the manager's `closest('[data-tabdroparea]')` match resolves.
export class FakeTabDropArea implements TabDropArea {
    ref: HTMLElement;
    hovers: TabHeader[] = [];
    drops: TabHeader[] = [];

    constructor() {
        this.ref = document.createElement('div');
        this.ref.setAttribute('data-tabdroparea', '');
        document.body.appendChild(this.ref);
    }
    onTabHover(_e: PointerEvent, hdr: TabHeader): void {
        this.hovers.push(hdr);
    }
    onTabDrop(_e: PointerEvent, hdr: TabHeader): void {
        this.drops.push(hdr);
    }
    getRef(): HTMLElement {
        return this.ref;
    }
    // Build a PointerEvent whose target lands inside this drop area's ref.
    eventOver(): PointerEvent {
        const e = new PointerEvent('pointerup', { clientX: 1, clientY: 1, bubbles: true });
        Object.defineProperty(e, 'target', { value: this.ref, configurable: true });
        return e;
    }
}

// A configurable FileSystemProvider stand-in, demonstrating the sourcing seam.
export class FakeFileProvider implements FileSystemProvider {
    constructor(
        private dirs: Record<string, FsEntry[]> = {},
        private files: Record<string, string> = {},
        private root = 'fake:/',
    ) {}
    rootPath(): string {
        return this.root;
    }
    listDir(path: string): Promise<FsEntry[]> {
        const e = this.dirs[path];
        return e ? Promise.resolve(e) : Promise.reject(new Error(`No such directory: ${path}`));
    }
    readFile(path: string): Promise<string> {
        const c = this.files[path];
        return c != null ? Promise.resolve(c) : Promise.reject(new Error(`No such file: ${path}`));
    }
    writeFile(path: string, contents: string): Promise<void> {
        this.files[path] = contents;
        return Promise.resolve();
    }
    stat(path: string): Promise<FsStat> {
        const c = this.files[path];
        if (c != null) return Promise.resolve({ path, kind: 'file', size: c.length, mtimeMs: 0 });
        if (this.dirs[path]) return Promise.resolve({ path, kind: 'dir', size: 0, mtimeMs: 0 });
        return Promise.reject(new Error(`No such path: ${path}`));
    }
    mkdir(path: string): Promise<void> {
        this.dirs[path] = this.dirs[path] ?? [];
        return Promise.resolve();
    }
    delete(path: string): Promise<void> {
        delete this.files[path];
        delete this.dirs[path];
        return Promise.resolve();
    }
    rename(from: string, to: string): Promise<void> {
        if (this.files[from] != null) { this.files[to] = this.files[from]; delete this.files[from]; }
        if (this.dirs[from]) { this.dirs[to] = this.dirs[from]; delete this.dirs[from]; }
        return Promise.resolve();
    }
}
