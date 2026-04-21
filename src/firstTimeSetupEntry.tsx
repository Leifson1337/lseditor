import React from 'react';
import { createRoot } from 'react-dom/client';
import FirstTimeSetup from './components/FirstTimeSetup';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <FirstTimeSetup />
    </React.StrictMode>
  );
}
