/* @refresh reload */
import { render } from 'solid-js/web';
import 'solid-devtools';

import '@fontsource-variable/google-sans-code/wght.css';
import '@fontsource-variable/figtree/wght.css';
import '@fontsource-variable/inter/wght.css';
import './styles/global.css';
import 'github-markdown-css/github-markdown-light.css';
import { installSplitMarkStyles } from './styles/SplitMarkStyles';
import App from './App';
import { APP_METADATA } from './appMetadata';

document.title = APP_METADATA.windowTitle;

// Prepare the split-mark seam rules once, AFTER the stylesheets above are in the
// cascade — the probe reads what they resolved, so it must run downstream of them.
installSplitMarkStyles();

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
  );
}

render(() => <App />, root!);
