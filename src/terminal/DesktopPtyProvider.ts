import type { DesktopBridge } from '../electron/desktopBridge';
import type { Dispose, PtyProvider, PtySession, PtySpawnOpts } from './PtyProvider';

class DesktopPtySession implements PtySession {
    private listeners: Dispose[] = [];
    private killed = false;

    constructor(
        readonly id: string,
        private bridge: DesktopBridge,
    ) {}

    write(data: string): void {
        void this.bridge.pty.write(this.id, data);
    }

    resize(cols: number, rows: number): void {
        void this.bridge.pty.resize(this.id, cols, rows);
    }

    onData(cb: (data: string) => void): Dispose {
        const dispose = this.bridge.pty.onData(this.id, cb);
        this.listeners.push(dispose);
        return dispose;
    }

    onExit(cb: (code: number) => void): Dispose {
        // The bridge reports { exitCode, signal }; the PtySession contract only
        // surfaces the numeric code, so we unwrap here.
        const dispose = this.bridge.pty.onExit(this.id, e => cb(e.exitCode));
        this.listeners.push(dispose);
        return dispose;
    }

    kill(): void {
        if (this.killed) return;
        this.killed = true;
        void this.bridge.pty.kill(this.id);
    }

    dispose(): void {
        // Tear down every listener first so no data/exit callback fires during
        // the kill, then kill the shell. kill() self-guards against a repeat.
        for (const d of this.listeners) d();
        this.listeners = [];
        this.kill();
    }
}

export class DesktopPtyProvider implements PtyProvider {
    constructor(private bridge: DesktopBridge) {}

    async spawn(opts: PtySpawnOpts): Promise<PtySession> {
        const id = await this.bridge.pty.spawn(opts);
        return new DesktopPtySession(id, this.bridge);
    }
}
