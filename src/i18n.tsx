import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type Language = 'en' | 'ja';

const MESSAGES = {
  en: {
    appName: 'MyKeebStudio',
    tools: 'Tools',
    device: 'Device',
    connectUsb: 'Connect USB',
    disconnect: 'Disconnect',
    working: 'Working…',
    layerViewer: 'Layer Viewer',
    keyTester: 'Key Tester',
    trackball: 'Trackball',
    runtimeCombo: 'Runtime Combo',
    customSettings: 'Custom Settings',
    keymapBackup: 'Keymap Backup',
    bleManagement: 'BLE Management',
    debugConsole: 'Debug Console',
    hide: 'Hide',
    copy: 'Copy',
    copied: 'Copied!',
    clear: 'Clear',
    resetPosition: 'Reset Position',
    noDebugEvents: 'No debug events yet.',
    layout: 'Layout',
    actualLayout: 'Keyboard',
    rawInputMonitor: 'Raw Input Monitor',
  },
  ja: {
    appName: 'MyKeebStudio',
    tools: 'ツール',
    device: 'デバイス',
    connectUsb: 'USB接続',
    disconnect: '切断',
    working: '処理中…',
    layerViewer: 'レイヤービューア',
    keyTester: 'キーテスター',
    trackball: 'トラックボール',
    runtimeCombo: 'ランタイムコンボ',
    customSettings: 'カスタム設定',
    keymapBackup: 'キーマップ バックアップ',
    bleManagement: 'BLE管理',
    debugConsole: 'デバッグコンソール',
    hide: '隠す',
    copy: 'コピー',
    copied: 'コピー済み',
    clear: 'クリア',
    resetPosition: '位置をリセット',
    noDebugEvents: 'デバッグイベントはまだありません。',
    layout: 'レイアウト',
    actualLayout: '実機',
    rawInputMonitor: 'Raw Input Monitor',
  },
} as const;

type MessageKey = keyof typeof MESSAGES.en;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  isJapanese: boolean;
  t: (key: MessageKey) => string;
};

const STORAGE_KEY = 'my-keeb-studio-language';

function initialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'ja') return saved;
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage: setLanguageState,
    isJapanese: language === 'ja',
    t: (key) => MESSAGES[language][key],
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.topbar'));
  }, []);

  if (!host) return null;

  return createPortal(
    <div className="language-switcher" role="group" aria-label="Language">
      <button type="button" className={language === 'ja' ? 'selected' : ''} onClick={() => setLanguage('ja')}>日本語</button>
      <button type="button" className={language === 'en' ? 'selected' : ''} onClick={() => setLanguage('en')}>English</button>
    </div>,
    host,
  );
}
