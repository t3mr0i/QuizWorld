// Content Moderation for Client-side
export class ClientContentModerator {
    static BLOCKED_KEYWORDS = [
        // Hate speech and discrimination
        'racist', 'racism', 'nazi', 'hitler', 'supremacist', 'genocide',
        'sexist', 'misogyn', 'homophob', 'transphob', 'terrorist',
        
        // Sexual content
        'porn', 'xxx', 'sex', 'nude', 'naked', 'erotic', 'fetish',
        
        // Violence and illegal
        'murder', 'kill', 'death', 'suicide', 'drug deal', 'weapon', 'gun',
        
        // Personal attacks
        'doxx', 'harassment', 'stalking', 'threaten', 'cyberbully'
    ];

    static FLAGGED_KEYWORDS = [
        'war', 'conflict', 'politics', 'religion', 'alcohol', 'medical'
    ];

    static POSITIVE_KEYWORDS = [
        'history', 'historical', 'educational', 'science', 'biology',
        'geography', 'literature', 'movies', 'entertainment', 'sports',
        'food', 'travel', 'technology', 'nature', 'animals'
    ];

    static validateTopic(topic, title = '') {
        const fullText = `${topic} ${title}`.toLowerCase().trim();
        
        // Check for blocked content
        for (const keyword of this.BLOCKED_KEYWORDS) {
            if (fullText.includes(keyword.toLowerCase())) {
                return {
                    isValid: false,
                    severity: 'high',
                    message: 'This topic contains inappropriate content that violates our community guidelines.',
                    suggestion: 'Try topics like science, history, entertainment, sports, or general knowledge.'
                };
            }
        }
        
        // Check for flagged content
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
                    message: 'This topic may be sensitive or controversial.',
                    suggestion: 'Consider focusing on educational, historical, or entertainment aspects.'
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
            'Famous Inventions'
        ];
    }

    static getContentGuidelines() {
        return [
            "✅ Educational topics (science, history, literature)",
            "✅ Entertainment (movies, music, sports, games)",
            "✅ General knowledge and trivia",
            "✅ Nature, animals, and geography",
            "✅ Food, travel, and culture (respectful)",
            "❌ Hate speech or discrimination",
            "❌ Explicit or inappropriate content",
            "❌ Violence or illegal activities",
            "❌ Personal attacks or harassment",
            "❌ Controversial political topics"
        ];
    }
} 