(window as any).global = window;
import React from 'react';
import ReactDOM from 'react-dom';
import App from './components/App';
import './styles/styles.css';
import './styles/App.css';
import { AIProvider } from './contexts/AIContext';

// Setze das Theme auf dark
document.documentElement.setAttribute('data-theme', 'dark');

ReactDOM.render(
  <React.StrictMode>
    <AIProvider>
      <App />
    </AIProvider>
  </React.StrictMode>,
  document.getElementById('root')
); 