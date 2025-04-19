(window as any).global = window;
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App';
import './styles/styles.css';
import './styles/App.css';
import { AIProvider } from './contexts/AIContext';

// Setze das Theme auf dark
document.documentElement.setAttribute('data-theme', 'dark');

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