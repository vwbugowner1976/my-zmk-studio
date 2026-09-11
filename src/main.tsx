import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DebugConsole from './DebugConsole';
import KeyTesterPortal from './KeyTesterPortal';
import BLEManagementPortal from './BLEManagementPortal';
import SensorBindingsPortal from './SensorBindingsPanel';
import { installDeviceExportNaming } from './deviceIdentity';
import { LanguageProvider, LanguageSwitcher } from './i18n';
import './styles.css';
import './layerViewer.css';
import './sensorBindings.css';
import './bindingPicker.css';
import './comboEditor.css';
import './customSettings.css';
import './v05.css';
import './keymapDiffGuide.css';
import './debugConsoleOverride.css';
import './deviceName.css';
import './language.css';
import './uiPolish.css';

installDeviceExportNaming();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
      <LanguageSwitcher />
      <SensorBindingsPortal />
      <DebugConsole />
      <KeyTesterPortal />
      <BLEManagementPortal />
    </LanguageProvider>
  </React.StrictMode>,
);
