import { TabContainer } from '../containers/Tabs';
import { TerminalTab } from '../containers/tabKinds';
import { SourceId } from '../textmodel/SourceId';
import { TerminalPane } from './TerminalPane';
import { NullTerminalPane } from './NullTerminalPane';
import type { PtyProvider } from './PtyProvider';

let terminalSeq = 0;

export function openNewTerminalTab(container: TabContainer, provider: PtyProvider): void {
    terminalSeq += 1;
    // The label ("Terminal N") is carried on the SourceId so the tab keys on
    // "terminal:N" but shows the user-facing name.
    const id = new SourceId('terminal', String(terminalSeq), `Terminal ${terminalSeq}`);
    // Demo builds get the null pane, which severs the @xterm import chain here
    // (see NullTerminalPane) — __DEMO__ is a literal, so one side shakes out.
    const pane = __DEMO__ ? new NullTerminalPane(provider) : new TerminalPane(provider);

    // ownsScroll false: xterm manages its own scrollback, so the tab frame must
    // NOT wrap it in an overflow:auto host (that would fight xterm's scroller).
    const tab = new TerminalTab(id, pane, false);

    container.addTab(tab);
    container.selectTab(tab);
}
