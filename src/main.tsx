import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DebugConsole from './DebugConsole';
import './styles.css';
import './layerViewer.css';
import './v05.css';
import './debugConsoleOverride.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <DebugConsole />
  </React.StrictMode>,
);
