import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DebugConsole from './DebugConsole';
import DeviceNameBadge from './DeviceNameBadge';
import { installDeviceExportNaming } from './deviceIdentity';
import './styles.css';
import './layerViewer.css';
import './bindingPicker.css';
import './comboEditor.css';
import './v05.css';
import './keymapDiffGuide.css';
import './debugConsoleOverride.css';
import './deviceName.css';

installDeviceExportNaming();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <DeviceNameBadge />
    <DebugConsole />
  </React.StrictMode>,
);
