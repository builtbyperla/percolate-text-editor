import type { DesktopBridge } from '../electron/desktopBridge';
import type { Dispose } from '../fileexplorer/FileSystemProvider';
import type { SearchProvider, SearchQuery, SearchMatch } from './SearchProvider';

export class DesktopSearchProvider implements SearchProvider {
    constructor(private bridge: DesktopBridge) {}

    run(query: SearchQuery, onMatch: (m: SearchMatch) => void, onDone: () => void): Dispose {
        return this.bridge.search.run(query, onMatch, onDone);
    }
}
