import type { PtyProvider, PtySession, PtySpawnOpts } from './PtyProvider';

export class NullPtyProvider implements PtyProvider {
    spawn(_opts: PtySpawnOpts): Promise<PtySession> {
        return Promise.reject(
            new Error('Terminal is only available in the desktop (Electron) build.'),
        );
    }
}
