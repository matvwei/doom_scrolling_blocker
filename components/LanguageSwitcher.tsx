import type { Language } from '../core/i18n';
import { translate } from '../core/i18n';

interface LanguageSwitcherProps {
  id: string;
  language: Language;
  onChange: (language: Language) => void;
}

export default function LanguageSwitcher({ id, language, onChange }: LanguageSwitcherProps) {
  return (
    <div className="language-switcher">
      <label htmlFor={id}>{translate(language, 'languageLabel')}</label>
      <select
        id={id}
        value={language}
        onChange={(event) => onChange(event.target.value as Language)}
      >
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}
