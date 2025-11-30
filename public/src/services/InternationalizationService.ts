import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Translation represents a single translation key-value pair.
 * It contains the translation key, value, context, and plural information.
 */
interface Translation {
  key: string;            // Translation key
  value: string;          // Translated value
  context?: string;       // Context for the translation
  plural?: string;        // Plural information for the translation
}

/**
 * Language represents a language with its code, name, native name, and translations.
 * It also contains a fallback language code.
 */
interface Language {
  code: string;           // Language code
  name: string;           // Language name
  nativeName: string;     // Native language name
  translations: Map<string, Translation>; // Map of translation keys to values
  fallback?: string;      // Fallback language code
}

/**
 * I18nConfig represents the configuration for the InternationalizationService.
 * It contains the default language, supported languages, translations path, auto-detect flag, and fallback language.
 */
interface I18nConfig {
  defaultLanguage: string; // Default language code
  supportedLanguages: string[]; // Array of supported language codes
  translationsPath: string; // Path to the translations files
  autoDetect: boolean;     // Flag to auto-detect the language
  fallbackLanguage: string; // Fallback language code
}

/**
 * InternationalizationService manages language selection, translation lookup, and formatting.
 * It emits events for language changes, translation additions, updates, and removals.
 */
export class InternationalizationService extends EventEmitter {
  private languages: Map<string, Language> = new Map(); // Loaded languages
  private currentLanguage: string; // Currently selected language
  private config: I18nConfig; // Configuration for the service

  /**
   * Constructor for the InternationalizationService.
   * Initializes the service with the provided configuration.
   * @param config Configuration for the service
   */
  constructor(config: I18nConfig) {
    super();
    this.config = config;
    this.currentLanguage = config.defaultLanguage;
    this.initialize();
  }

  /**
   * Initializes the service by loading the languages and detecting the language if auto-detect is enabled.
   */
  private initialize(): void {
    this.loadLanguages();
    if (this.config.autoDetect) {
      this.detectLanguage();
    }
  }

  /**
   * Loads the languages from the translations files.
   */
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

  /**
   * Detects the language from the browser's language setting.
   */
  private detectLanguage(): void {
    // Try to detect language from browser
    const browserLanguage = navigator.language.split('-')[0];
    if (this.languages.has(browserLanguage)) {
      this.setLanguage(browserLanguage);
    } else {
      this.setLanguage(this.config.fallbackLanguage);
    }
  }

  /**
   * Sets the current language.
   * @param code Language code
   */
  public setLanguage(code: string): void {
    if (this.languages.has(code)) {
      this.currentLanguage = code;
      this.emit('languageChanged', code);
    } else {
      console.warn(`Language ${code} not supported`);
    }
  }

  /**
   * Gets the current language code.
   * @returns Current language code
   */
  public getLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * Gets the supported languages.
   * @returns Array of language codes
   */
  public getSupportedLanguages(): Language[] {
    return Array.from(this.languages.values());
  }

  /**
   * Translates a key using the current language.
   * @param key Translation key
   * @param params Parameters for the translation
   * @returns Translated value or the key if not found
   */
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

  /**
   * Adds a translation for a language.
   * @param languageCode Language code
   * @param key Translation key
   * @param value Translated value
   * @param context Context for the translation
   */
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

  /**
   * Updates a translation for a language.
   * @param languageCode Language code
   * @param key Translation key
   * @param value Translated value
   */
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

  /**
   * Removes a translation for a language.
   * @param languageCode Language code
   * @param key Translation key
   */
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

  /**
   * Saves a language to the translations file.
   * @param languageCode Language code
   */
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

  /**
   * Gets the missing translations for a language.
   * @param languageCode Language code
   * @returns Array of missing translation keys
   */
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

  /**
   * Formats a date using the current language.
   * @param date Date to format
   * @param format Format for the date
   * @returns Formatted date string
   */
  public formatDate(date: Date, format?: string): string {
    const language = this.languages.get(this.currentLanguage);
    if (!language) {
      return date.toLocaleDateString();
    }

    // Implement date formatting based on language
    return date.toLocaleDateString(language.code);
  }

  /**
   * Formats a number using the current language.
   * @param number Number to format
   * @param options Options for the number formatting
   * @returns Formatted number string
   */
  public formatNumber(number: number, options?: Intl.NumberFormatOptions): string {
    const language = this.languages.get(this.currentLanguage);
    if (!language) {
      return number.toString();
    }

    return new Intl.NumberFormat(language.code, options).format(number);
  }

  /**
   * Formats a currency using the current language.
   * @param amount Amount to format
   * @param currency Currency code
   * @param options Options for the currency formatting
   * @returns Formatted currency string
   */
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

  /**
   * Disposes the service by clearing the languages and removing all listeners.
   */
  public dispose(): void {
    this.languages.clear();
    this.removeAllListeners();
  }
}