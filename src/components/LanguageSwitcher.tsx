import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';
import { HoverBorderGradient } from './ui/hover-border-gradient';
import { useTheme } from '../hooks/useTheme';

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'zh', name: '中文', flag: '🇨🇳' }
];

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const { isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLanguage = languages.find(lang => lang.code === i18n.language) || languages[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <HoverBorderGradient
        as="button"
        containerClassName="rounded-full"
        className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
          isDark
            ? 'bg-[var(--sf-bg-deep)] text-neutral-300'
            : 'bg-white text-gray-700'
        }`}
        fillClassName={isDark ? undefined : 'bg-white'}
        duration={3}
        onClick={() => setIsOpen(!isOpen)}
        title={t('language.switchLanguage')}
      >
        <Globe size={18} />
      </HoverBorderGradient>

      {isOpen && (
        <div
          className={`absolute right-0 mt-2 w-40 rounded-xl shadow-2xl border overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${
            isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-gray-200 shadow-md'
          }`}
        >
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                isDark
                  ? 'hover:bg-neutral-800 text-neutral-300 hover:text-white'
                  : 'hover:bg-neutral-100 text-gray-500 hover:sf-rainbow-text'
              }`}
            >
              <span className="text-lg">{lang.flag}</span>
              <span className="flex-1 text-left text-sm font-medium">{lang.name}</span>
              {i18n.language === lang.code && (
                <Check size={16} className="sf-rainbow-text" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
