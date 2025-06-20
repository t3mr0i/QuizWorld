// Content Moderation for Client-side
export class ClientContentModerator {
    static BLOCKED_KEYWORDS = [
        // Hate speech and discrimination
        'racist', 'racism', 'nazi', 'hitler', 'supremacist', 'genocide',
        'sexist', 'misogyn', 'homophob', 'transphob', 'terrorist',
        
        // Explicit sexual content
        'hardcore sex', 'nude photos', 'naked pics', 'erotic images', 'fetish porn', 'bdsm porn',
        
        // Instructions for illegal activities
        'how to murder', 'how to kill', 'murder methods', 'assassination',
        'how to make drugs', 'drug manufacturing', 'cocaine production', 'heroin production',
        'how to make weapons', 'bomb instructions', 'explosive instructions',
        'how to hack', 'illegal hacking', 'credit card fraud', 'identity theft',
        
        // Personal attacks
        'doxx', 'harassment', 'stalking', 'threaten', 'cyberbully', 'death threat'
    ];

    static FLAGGED_KEYWORDS = [
        'controversial', 'political party', 'sensitive topic', 'adult content'
    ];

    static POSITIVE_KEYWORDS = [
        'history', 'historical', 'educational', 'science', 'biology', 'academic', 'learning',
        'geography', 'literature', 'movies', 'entertainment', 'sports', 'music', 'bands', 'artists',
        'food', 'travel', 'technology', 'nature', 'animals', 'medicine', 'healthcare',
        'religion', 'religious', 'mythology', 'cultural', 'tradition', 'festival',
        'alcohol', 'beer', 'wine', 'spirits', 'brewing', 'cocktails', 'bartending',
        'quiz', 'trivia', 'knowledge', 'facts', 'general knowledge', 'cooking', 'culinary'
    ];

    static validateTopic(topic, title = '') {
        const fullText = `${topic} ${title}`.toLowerCase().trim();
        
        // Check for blocked content (truly illegal or harmful)
        for (const keyword of this.BLOCKED_KEYWORDS) {
            if (fullText.includes(keyword.toLowerCase())) {
                return {
                    isValid: false,
                    severity: 'high',
                    message: 'This topic contains content that violates our community guidelines.',
                    suggestion: 'Try topics like science, history, entertainment, sports, or general knowledge.'
                };
            }
        }
        
        // Check for flagged content (potentially sensitive but often legitimate)
        const flaggedCount = this.FLAGGED_KEYWORDS.filter(keyword => 
            fullText.includes(keyword.toLowerCase())
        ).length;
        
        if (flaggedCount > 0) {
            const positiveCount = this.POSITIVE_KEYWORDS.filter(keyword => 
                fullText.includes(keyword.toLowerCase())
            ).length;
            
            if (positiveCount === 0) {
                return {
                    isValid: false,
                    severity: 'medium',
                    message: 'This topic may be sensitive. Consider adding educational context.',
                    suggestion: 'Try adding educational context like "History of..." or "Science of..." to make the topic more appropriate.'
                };
            }
        }
        
        return {
            isValid: true,
            severity: 'low',
            message: 'Topic looks good!'
        };
    }

    static getSuggestedTopics() {
        return [
            'Ancient Civilizations History',
            'Space and Astronomy',
            'World Geography and Landmarks',
            'Classic Literature and Authors',
            'Movie Trivia and Entertainment',
            'Scientific Discoveries',
            'Animal Kingdom and Nature',
            'World Cuisine and Food Culture',
            'Sports and Olympics',
            'Technology and Innovation',
            'Art and Famous Artists',
            'Music History and Genres',
            'Travel Destinations',
            'Video Games and Gaming',
            'Famous Inventions',
            'Beer and Brewing History',
            'Wine Regions of the World',
            'Cocktail Recipes and Bartending',
            'World Religions and Mythology',
            'Medical Breakthroughs and Healthcare'
        ];
    }

    static getContentGuidelines() {
        return [
            "✅ Educational topics (science, history, literature, medicine)",
            "✅ Entertainment (movies, music, sports, games, celebrities)",
            "✅ General knowledge and trivia",
            "✅ Nature, animals, and geography",
            "✅ Food, travel, and culture (respectful)",
            "✅ Alcohol and beverages (beer, wine, cocktails, history)",
            "✅ Religion and mythology (presented respectfully)",
            "✅ Historical events and figures",
            "❌ Instructions for illegal activities",
            "❌ Hate speech or discrimination",
            "❌ Explicit sexual content",
            "❌ Personal attacks or harassment"
        ];
    }
} 