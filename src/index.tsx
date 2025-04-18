import React from 'react';
import ReactDOM from 'react-dom';
import App from './components/App';
import './styles/styles.css';
import './styles/App.css';

// Setze das Theme auf dark
document.documentElement.setAttribute('data-theme', 'dark');

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
); 