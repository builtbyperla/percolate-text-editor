import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { MessageDTO, SessionSnapshot, SessionSummary } from '../../shared/agentProtocol';
import { nextForkDisplayName } from '../../shared/sessionDisplayName';

interface SessionRow {
    id: string;
    parent_id: string | null;
    agent: string;
    title: string | null;
    display_name: string | null;
    archived: number;
    approval_mode: SessionSnapshot['approvalMode'];
    steering_policy: SessionSnapshot['steeringPolicy'];
    state: SessionSnapshot['state'];
    context_cutoff: number;
    created_at: number;
    updated_at: number;
}

interface MessageRow {
    id: string;
    role: MessageDTO['role'];
    status: MessageDTO['status'];
    blocks_json: string;
    created_at: number;
}

export class SessionRepository {
    private readonly db: Database.Database;

    constructor(filename: string) {
        this.db = new Database(filename);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.migrate();
        this.recoverStaleState();
    }

    save(snapshot: SessionSnapshot, parentId: string | null = null): void {
        this.db.transaction(() => {
            this.db.prepare(`
                INSERT INTO sessions (
                    id, parent_id, agent, title, display_name, archived, approval_mode, steering_policy,
                    state, context_cutoff, created_at, updated_at
                )
                VALUES (
                    @id, @parentId, @agent, @displayName, @displayName, @archived, @approvalMode, @steeringPolicy,
                    @state, @contextCutoff, @createdAt, @updatedAt
                )
                ON CONFLICT(id) DO UPDATE SET
                    agent = excluded.agent,
                    title = excluded.display_name,
                    display_name = excluded.display_name,
                    archived = excluded.archived,
                    approval_mode = excluded.approval_mode,
                    steering_policy = excluded.steering_policy,
                    state = excluded.state,
                    context_cutoff = excluded.context_cutoff,
                    updated_at = excluded.updated_at
            `).run({
                ...snapshot,
                archived: snapshot.archived ? 1 : 0,
                contextCutoff: snapshot.contextCutoff ?? 0,
                parentId,
            });
            this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(snapshot.id);
            const insert = this.db.prepare(`
                INSERT INTO messages (id, session_id, position, role, status, blocks_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            snapshot.messages.forEach((message, position) => {
                insert.run(
                    message.id,
                    snapshot.id,
                    position,
                    message.role,
                    message.status,
                    JSON.stringify(message.blocks),
                    message.createdAt,
                );
            });
        })();
    }

    list(): SessionSummary[] {
        const rows = this.db.prepare('SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC').all() as SessionRow[];
        return rows.map(row => this.summary(row));
    }

    displayNames(): string[] {
        return (this.db.prepare('SELECT COALESCE(display_name, title) AS name FROM sessions').all() as Array<{ name: string }>).map(row => row.name);
    }

    rename(id: string, displayName: string): void {
        const result = this.db.prepare(`
            UPDATE sessions SET display_name = ?, title = ?, updated_at = ? WHERE id = ?
        `).run(displayName, displayName, Date.now(), id);
        if (result.changes === 0) throw new Error('Unknown agent session.');
    }

    archive(id: string): void {
        const result = this.db.prepare('UPDATE sessions SET archived = 1, updated_at = ? WHERE id = ?')
            .run(Date.now(), id);
        if (result.changes === 0) throw new Error('Unknown agent session.');
    }

    load(id: string): SessionSnapshot | undefined {
        const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
        if (!row) return undefined;

        const rows = this.db.prepare(`
            SELECT id, role, status, blocks_json, created_at
            FROM messages
            WHERE session_id = ?
            ORDER BY position
        `).all(id) as MessageRow[];
        const messages = rows.map(message => ({
            id: message.id,
            role: message.role,
            status: message.status,
            blocks: JSON.parse(message.blocks_json),
            createdAt: message.created_at,
        }));

        return {
            ...this.summary(row),
            approvalMode: row.approval_mode,
            steeringPolicy: row.steering_policy,
            contextCutoff: row.context_cutoff || undefined,
            messages,
        };
    }

    fork(id: string, throughBlockId?: string): SessionSnapshot {
        const source = this.load(id);
        if (!source) throw new Error('Unknown agent session.');

        const selectedIndex = throughBlockId == null
            ? source.messages.length - 1
            : source.messages.findIndex(message => (
                message.id === throughBlockId
                || message.blocks.some(block => block.id === throughBlockId)
            ));
        if (throughBlockId != null && selectedIndex < 0) {
            throw new Error('The selected message no longer exists.');
        }

        const messages = source.messages.slice(0, selectedIndex + 1);
        const now = Date.now();
        const names = this.db.prepare('SELECT COALESCE(display_name, title) AS name FROM sessions')
            .all() as Array<{ name: string }>;
        const fork: SessionSnapshot = {
            ...structuredClone(source),
            id: randomUUID(),
            displayName: nextForkDisplayName(source.displayName, names.map(row => row.name)),
            archived: false,
            state: 'IDLE',
            createdAt: now,
            updatedAt: now,
            contextCutoff: throughBlockId == null
                ? Math.min(source.contextCutoff ?? 0, messages.length) || undefined
                : undefined,
            messages: messages.map(message => ({
                ...message,
                id: randomUUID(),
                blocks: message.blocks.map(block => block.kind === 'tool' && block.fileEdit && block.status === 'pending'
                    ? { ...block, id: randomUUID(), fileEdit: undefined, status: 'skipped' as const, output: 'Pending file edits are not copied into a fork.', controlAction: { kind: 'skipped' as const } }
                    : { ...block, id: randomUUID() }),
            })),
        };
        this.save(fork, source.id);
        return fork;
    }

    close(): void {
        this.db.close();
    }

    private summary(row: SessionRow): SessionSummary {
        return {
            id: row.id,
            agent: row.agent,
            displayName: row.display_name ?? row.title ?? 'New session',
            archived: row.archived === 1,
            state: row.state,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                agent TEXT NOT NULL,
                title TEXT,
                display_name TEXT,
                archived INTEGER NOT NULL DEFAULT 0,
                approval_mode TEXT NOT NULL,
                steering_policy TEXT NOT NULL,
                state TEXT NOT NULL,
                context_cutoff INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                role TEXT NOT NULL,
                status TEXT NOT NULL,
                blocks_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id),
                UNIQUE(session_id, position)
            );
            INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
        `);
        const columns = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
        if (!columns.some(column => column.name === 'context_cutoff')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN context_cutoff INTEGER NOT NULL DEFAULT 0');
        }
        this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)').run();
        if (!columns.some(column => column.name === 'display_name')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN display_name TEXT');
            this.db.exec('UPDATE sessions SET display_name = COALESCE(title, \'New session\')');
        }
        if (!columns.some(column => column.name === 'archived')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
        }
        this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (3)').run();
        this.db.exec(`
            UPDATE sessions
            SET approval_mode = CASE approval_mode
                WHEN 'ask_mutations' THEN 'ask'
                WHEN 'ask_all' THEN 'ask'
                WHEN 'plan' THEN 'ask'
                WHEN 'slow' THEN 'ask'
                WHEN 'quick' THEN 'timer-quick'
                ELSE approval_mode
            END
        `);
        this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (4)').run();
    }

    private recoverStaleState(): void {
        this.db.transaction(() => {
            const rows = this.db.prepare('SELECT id, status, blocks_json FROM messages').all() as Array<{
                id: string;
                status: MessageDTO['status'];
                blocks_json: string;
            }>;
            const update = this.db.prepare('UPDATE messages SET status = ?, blocks_json = ? WHERE id = ?');

            for (const row of rows) {
                const blocks = JSON.parse(row.blocks_json) as Array<{ kind?: string; status?: string; output?: string }>;
                let changed = row.status === 'streaming';
                for (const block of blocks) {
                    if (block.status === 'streaming') {
                        block.status = 'interrupted';
                        changed = true;
                    } else if (block.kind === 'tool' && block.status === 'running') {
                        block.status = 'error';
                        block.output ||= 'Interrupted by application restart.';
                        changed = true;
                    }
                }
                if (changed) {
                    update.run(
                        row.status === 'streaming' ? 'interrupted' : row.status,
                        JSON.stringify(blocks),
                        row.id,
                    );
                }
            }
            this.db.prepare("UPDATE sessions SET state = 'IDLE' WHERE state IN ('CALLING_AGENT','RUNNING_TOOL','CANCELLING')").run();
        })();
    }
}
