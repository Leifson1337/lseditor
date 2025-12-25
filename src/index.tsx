// index.tsx
// Entry point for the React renderer process. Bootstraps the React app and attaches it to the DOM.

/**
 * This file initializes the React application, rendering the root component
 * into the DOM and setting up any global providers or error boundaries.
 */

(window as any).global = window;
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App';
import './styles/styles.css';
import './styles/App.css';
import { AIProvider } from './contexts/AIContext';

// monaco-vscode-api initialization
import { initialize } from 'vscode/services';
// import '@codingame/monaco-vscode-api/default-extensions/theme-defaults';
// import '@codingame/monaco-vscode-api/default-extensions/javascript';
// import '@codingame/monaco-vscode-api/default-extensions/typescript';

// Initialize VS Code services
initialize({}).then(() => {
  console.log('VS Code API initialized');
}).catch((err: any) => {
  console.error('Failed to initialize VS Code API:', err);
});

// Setze das Theme auf dark
document.documentElement.setAttribute('data-theme', 'dark');

/**
 * Create the root element and render the React app.
 * This section is responsible for setting up the React DOM and rendering the
 * top-level component.
 */
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <AIProvider>
        <App />
      </AIProvider>
    </React.StrictMode>
  );
}