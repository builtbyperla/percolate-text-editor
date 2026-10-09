import type { AgentClient } from './AgentClient';

export class DesktopAgentClient implements AgentClient {
    readonly available = true;
    attachmentSupport() { return this.agent.attachmentSupport(); }
    private get agent() {
        const agent = window.desktopBridge?.agent;
        if (!agent) throw new Error('The desktop agent bridge is unavailable.');
        return agent;
    }
    createSession(agent?: string) { return this.agent.createSession(agent); }
    listSessions() { return this.agent.listSessions(); }
    loadSession(id: string) { return this.agent.loadSession(id); }
    forkSession(id: string, throughBlockId?: string) { return this.agent.forkSession(id, throughBlockId); }
    renameSession(id: string, displayName: string) { return this.agent.renameSession(id, displayName); }
    archiveSession(id: string) { return this.agent.archiveSession(id); }
    send(input: Parameters<AgentClient['send']>[0]) { return this.agent.send(input); }
    respond(input: Parameters<AgentClient['respond']>[0]) { return this.agent.respond(input); }
    cancel(sessionId: string) { return this.agent.cancel(sessionId); }
    stop(sessionId: string) { return this.agent.stop(sessionId); }
    undo(sessionId: string, toolCallId: string) { return this.agent.undo(sessionId, toolCallId); }
    readFileEdit(sessionId: string, artifactId: string) { return this.agent.readFileEdit(sessionId, artifactId); }
    updateFileEdit(sessionId: string, artifactId: string, revision: number, content: string) { return this.agent.updateFileEdit(sessionId, artifactId, revision, content); }
    contextStats(sessionId: string) { return this.agent.contextStats(sessionId); }
    compact(sessionId: string) { return this.agent.compact(sessionId); }
    setPaused(sessionId: string, paused: boolean) { return this.agent.setPaused(sessionId, paused); }
    setApprovalMode(sessionId: string, mode: Parameters<AgentClient['setApprovalMode']>[1]) { return this.agent.setApprovalMode(sessionId, mode); }
    onEvent(sessionId: string, cb: Parameters<AgentClient['onEvent']>[1]) { return this.agent.onEvent(sessionId, cb); }
}
