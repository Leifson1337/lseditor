import React from 'react';
import { createRoot } from 'react-dom/client';
import BackendPreference from './components/BackendPreference';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <BackendPreference />
    </React.StrictMode>
  );
}
