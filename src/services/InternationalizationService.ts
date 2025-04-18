import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

interface Translation {
  key: string;
  value: string;
  context?: string;
  plural?: string;
}

interface Language {
  code: string;
  name: string;
  nativeName: string;
  translations: Map<string, Translation>;
  fallback?: string;
}

interface I18nConfig {
  defaultLanguage: string;
  supportedLanguages: string[];
  translationsPath: string;
  autoDetect: boolean;
  fallbackLanguage: string;
}

export class InternationalizationService extends EventEmitter {
  private languages: Map<string, Language> = new Map();
  private currentLanguage: string;
  private config: I18nConfig;

  constructor(config: I18nConfig) {
    super();
    this.config = config;
    this.currentLanguage = config.defaultLanguage;
    this.initialize();
  }

  private initialize(): void {
    this.loadLanguages();
    if (this.config.autoDetect) {
      this.detectLanguage();
    }
  }

  private loadLanguages(): void {
    this.config.supportedLanguages.forEach(code => {
      const languagePath = path.join(this.config.translationsPath, `${code}.json`);
      if (fs.existsSync(languagePath)) {
        try {
          const translations = JSON.parse(fs.readFileSync(languagePath, 'utf-8'));
          const language: Language = {
            code,
            name: translations._meta?.name || code,
            nativeName: translations._meta?.nativeName || code,
            translations: new Map(),
            fallback: translations._meta?.fallback
          };

          Object.entries(translations).forEach(([key, value]) => {
            if (key !== '_meta') {
              language.translations.set(key, {
                key,
                value: value as string
              });
            }
          });

          this.languages.set(code, language);
        } catch (error) {
          console.error(`Failed to load language ${code}:`, error);
        }
      }
    });
  }

  private detectLanguage(): void {
    // Try to detect language from browser
    const browserLanguage = navigator.language.split('-')[0];
    if (this.languages.has(browserLanguage)) {
      this.setLanguage(browserLanguage);
    } else {
      this.setLanguage(this.config.fallbackLanguage);
    }
  }

  public setLanguage(code: string): void {
    if (this.languages.has(code)) {
      this.currentLanguage = code;
      this.emit('languageChanged', code);
    } else {
      console.warn(`Language ${code} not supported`);
    }
  }

  public getLanguage(): string {
    return this.currentLanguage;
  }

  public getSupportedLanguages(): Language[] {
    return Array.from(this.languages.values());
  }

  public translate(key: string, params?: Record<string, any>): string {
    const language = this.languages.get(this.currentLanguage);
    if (!language) {
      return key;
    }

    let translation = language.translations.get(key);
    if (!translation && language.fallback) {
      const fallbackLanguage = this.languages.get(language.fallback);
      if (fallbackLanguage) {
        translation = fallbackLanguage.translations.get(key);
      }
    }

    if (!translation) {
      return key;
    }

    let result = translation.value;
    if (params) {
      Object.entries(params).forEach(([param, value]) => {
        result = result.replace(new RegExp(`{${param}}`, 'g'), String(value));
      });
    }

    return result;
  }

  public addTranslation(
    languageCode: string,
    key: string,
    value: string,
    context?: string
  ): void {
    const language = this.languages.get(languageCode);
    if (!language) {
      throw new Error(`Language ${languageCode} not found`);
    }

    language.translations.set(key, {
      key,
      value,
      context
    });

    this.saveLanguage(languageCode);
    this.emit('translationAdded', { languageCode, key, value });
  }

  public updateTranslation(
    languageCode: string,
    key: string,
    value: string
  ): void {
    const language = this.languages.get(languageCode);
    if (!language) {
      throw new Error(`Language ${languageCode} not found`);
    }

    const translation = language.translations.get(key);
    if (!translation) {
      throw new Error(`Translation ${key} not found`);
    }

    translation.value = value;
    language.translations.set(key, translation);

    this.saveLanguage(languageCode);
    this.emit('translationUpdated', { languageCode, key, value });
  }

  public removeTranslation(languageCode: string, key: string): void {
    const language = this.languages.get(languageCode);
    if (!language) {
      throw new Error(`Language ${languageCode} not found`);
    }

    if (language.translations.delete(key)) {
      this.saveLanguage(languageCode);
      this.emit('translationRemoved', { languageCode, key });
    }
  }

  private saveLanguage(languageCode: string): void {
    const language = this.languages.get(languageCode);
    if (!language) {
      throw new Error(`Language ${languageCode} not found`);
    }

    const translations: Record<string, any> = {
      _meta: {
        name: language.name,
        nativeName: language.nativeName,
        fallback: language.fallback
      }
    };

    language.translations.forEach((translation, key) => {
      translations[key] = translation.value;
    });

    const languagePath = path.join(this.config.translationsPath, `${languageCode}.json`);
    fs.writeFileSync(languagePath, JSON.stringify(translations, null, 2));
  }

  public getMissingTranslations(languageCode: string): string[] {
    const language = this.languages.get(languageCode);
    if (!language) {
      throw new Error(`Language ${languageCode} not found`);
    }

    const defaultLanguage = this.languages.get(this.config.defaultLanguage);
    if (!defaultLanguage) {
      return [];
    }

    const missing: string[] = [];
    defaultLanguage.translations.forEach((_, key) => {
      if (!language.translations.has(key)) {
        missing.push(key);
      }
    });

    return missing;
  }

  public formatDate(date: Date, format?: string): string {
    const language = this.languages.get(this.currentLanguage);
    if (!language) {
      return date.toLocaleDateString();
    }

    // Implement date formatting based on language
    return date.toLocaleDateString(language.code);
  }

  public formatNumber(number: number, options?: Intl.NumberFormatOptions): string {
    const language = this.languages.get(this.currentLanguage);
    if (!language) {
      return number.toString();
    }

    return new Intl.NumberFormat(language.code, options).format(number);
  }

  public formatCurrency(
    amount: number,
    currency: string,
    options?: Intl.NumberFormatOptions
  ): string {
    const language = this.languages.get(this.currentLanguage);
    if (!language) {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        ...options
      }).format(amount);
    }

    return new Intl.NumberFormat(language.code, {
      style: 'currency',
      currency,
      ...options
    }).format(amount);
  }

  public dispose(): void {
    this.languages.clear();
    this.removeAllListeners();
  }
} 