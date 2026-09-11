import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Language = 'en' | 'ja';

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  isJapanese: boolean;
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
  return (
    <div className="language-switcher" role="group" aria-label="Language">
      <button type="button" className={language === 'ja' ? 'selected' : ''} onClick={() => setLanguage('ja')}>日本語</button>
      <button type="button" className={language === 'en' ? 'selected' : ''} onClick={() => setLanguage('en')}>English</button>
    </div>
  );
}
