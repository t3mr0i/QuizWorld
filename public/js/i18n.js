// i18n System for Smart Land Plus
class I18n {
    constructor() {
        this.currentLanguage = 'de';
        this.translations = {};
        this.fallbackLanguage = 'en';
        this.loadedLanguages = new Set();
    }

    async init(language = 'de') {
        this.currentLanguage = language;
        await this.loadLanguage(language);
        
        // Load fallback language if different
        if (language !== this.fallbackLanguage) {
            await this.loadLanguage(this.fallbackLanguage);
        }
        
        this.updateUI();
    }

    async loadLanguage(lang) {
        if (this.loadedLanguages.has(lang)) {
            return;
        }

        try {
            const response = await fetch(`i18n/${lang}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load language file: ${lang}`);
            }
            
            const translations = await response.json();
            this.translations[lang] = translations;
            this.loadedLanguages.add(lang);
            
            console.log(`Loaded translations for: ${lang}`);
        } catch (error) {
            console.error(`Error loading language ${lang}:`, error);
            
            // If we can't load the requested language and it's not the fallback,
            // try to load the fallback
            if (lang !== this.fallbackLanguage) {
                console.log(`Falling back to ${this.fallbackLanguage}`);
                await this.loadLanguage(this.fallbackLanguage);
            }
        }
    }

    async changeLanguage(language) {
        if (language === this.currentLanguage) {
            return;
        }

        this.currentLanguage = language;
        
        // Load the language if not already loaded
        if (!this.loadedLanguages.has(language)) {
            await this.loadLanguage(language);
        }
        
        this.updateUI();
        
        // Trigger custom event for language change
        window.dispatchEvent(new CustomEvent('languageChanged', { 
            detail: { language: language } 
        }));
    }

    t(key, params = {}) {
        const keys = key.split('.');
        let value = this.getNestedValue(this.translations[this.currentLanguage], keys);
        
        // Fallback to default language if translation not found
        if (value === undefined && this.currentLanguage !== this.fallbackLanguage) {
            value = this.getNestedValue(this.translations[this.fallbackLanguage], keys);
        }
        
        // If still not found, return the key itself
        if (value === undefined) {
            console.warn(`Translation not found for key: ${key}`);
            return key;
        }
        
        // Replace parameters in the translation
        return this.replaceParams(value, params);
    }

    getNestedValue(obj, keys) {
        return keys.reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : undefined;
        }, obj);
    }

    replaceParams(text, params) {
        if (typeof text !== 'string') {
            return text;
        }
        
        return text.replace(/\{(\w+)\}/g, (match, key) => {
            return params[key] !== undefined ? params[key] : match;
        });
    }

    updateUI() {
        // Update all elements with data-i18n attribute
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.t(key);
            
            if (element.tagName === 'INPUT' && (element.type === 'text' || element.type === 'email')) {
                element.placeholder = translation;
            } else if (element.hasAttribute('title')) {
                element.title = translation;
            } else {
                element.textContent = translation;
            }
        });

        // Update all elements with data-i18n-html attribute (for HTML content)
        document.querySelectorAll('[data-i18n-html]').forEach(element => {
            const key = element.getAttribute('data-i18n-html');
            const translation = this.t(key);
            element.innerHTML = translation;
        });

        // Update language selector options
        this.updateLanguageSelector();
        
        // Update explanation content
        this.updateExplanationContent();
    }

    updateLanguageSelector() {
        const selector = document.getElementById('game-language');
        if (!selector) return;

        // Update option texts
        selector.querySelectorAll('option').forEach(option => {
            const langCode = option.value;
            const langName = this.t(`languages.${langCode}`);
            if (langName !== `languages.${langCode}`) {
                option.textContent = langName;
            }
        });
    }

    updateExplanationContent() {
        const explanationText = document.getElementById('explanation-text');
        const explanationToggle = document.getElementById('explanation-toggle');
        const explanationContent = document.getElementById('explanation-content');
        
        if (!explanationText || !explanationToggle) return;

        // Update toggle button text
        const isExpanded = !explanationContent.classList.contains('hidden');
        const toggleKey = isExpanded ? 'explanation.toggleButtonExpanded' : 'explanation.toggleButton';
        explanationToggle.textContent = this.t(toggleKey);

        // Build explanation content HTML
        const content = this.t('explanation.content');
        if (typeof content === 'object') {
            let html = `
                <h4>${content.whatIsTitle}</h4>
                <p>${content.whatIsText}</p>
                
                <h4>${content.howWorksTitle}</h4>
                <ol>
            `;
            
            content.howWorksSteps.forEach(step => {
                html += `<li><strong>${step.title}</strong> ${step.text}</li>`;
            });
            
            html += `
                </ol>
                
                <h4>${content.scoringTitle}</h4>
                <ul>
            `;
            
            content.scoringItems.forEach(item => {
                html += `<li><strong>${item.title}</strong> ${item.text}</li>`;
            });
            
            html += `
                </ul>
                
                <h4>${content.tipsTitle}</h4>
                <ul>
            `;
            
            content.tipsItems.forEach(tip => {
                html += `<li>${tip}</li>`;
            });
            
            html += `
                </ul>
                
                <p><strong>${content.goodLuck}</strong></p>
            `;
            
            explanationText.innerHTML = html;
        }
    }

    // Helper method to get available languages
    getAvailableLanguages() {
        return ['de', 'en', 'fr', 'es', 'it', 'nl'];
    }

    // Helper method to get current language
    getCurrentLanguage() {
        return this.currentLanguage;
    }
}

// Create global i18n instance
window.i18n = new I18n(); 