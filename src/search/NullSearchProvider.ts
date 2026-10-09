import type { Dispose } from '../fileexplorer/FileSystemProvider';
import type { SearchProvider, SearchQuery, SearchMatch } from './SearchProvider';

export class NullSearchProvider implements SearchProvider {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    run(_query: SearchQuery, _onMatch: (m: SearchMatch) => void, onDone: () => void): Dispose {
        // Complete on a microtask so the caller can wire up state before onDone
        // fires (a synchronous onDone would run before run() returns its Dispose).
        queueMicrotask(onDone);
        return () => {};
    }

    isAvailable(): boolean {
        return false;
    }
}
