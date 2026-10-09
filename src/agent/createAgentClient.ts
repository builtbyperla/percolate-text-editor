import type { AgentClient } from './AgentClient';
import { DemoAgentClient } from './DemoAgentClient';
import { DesktopAgentClient } from './DesktopAgentClient';

// A normal Vite dev server has no Electron preload bridge. It should still be a
// useful local mode, backed by the same fixture-driven client as the static demo.
export function createAgentClient(): AgentClient {
    if (window.desktopBridge?.agent) return new DesktopAgentClient();
    return new DemoAgentClient(__DEMO__ ? 'passive' : 'interactive');
}
