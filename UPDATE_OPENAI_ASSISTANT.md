# How to Update OpenAI Assistant for Multilingual Support

## Overview
The Stadt Land Fluss game now supports 6 languages and sends the selected language to the OpenAI Assistant for validation. You need to update your OpenAI Assistant with new system instructions.

## Steps to Update

### 1. Access OpenAI Assistant
- Go to [OpenAI Platform](https://platform.openai.com/)
- Navigate to Assistants
- Find your assistant: `asst_3Lqlm7XjAeciaGU8VbVOS8Al`

### 2. Update System Instructions
Replace the current system instructions with the content from `OPENAI_ASSISTANT_INSTRUCTIONS.md`

### 3. Key Changes Made

#### Language Support
- **German (de)**: Primary language, most lenient
- **English (en)**: International context
- **French (fr)**: French cultural context
- **Spanish (es)**: Spanish/Latin American context
- **Italian (it)**: Italian cultural context
- **Dutch (nl)**: Dutch/Flemish context

#### Enhanced Validation
- Language-adaptive validation rules
- Cultural awareness for each language
- Regional spelling variants accepted
- Language-specific explanations

#### Improved Scoring
- 20 points: Perfect, unique answer
- 15 points: Correct with minor spelling errors
- 10 points: Valid but common answer
- 0 points: Invalid answer

## What the Server Now Sends

The validation request now includes:
```
VALIDATION REQUEST
Letter: A
Language: de (German)
Game Context: Stadt Land Fluss (City Country River)

IMPORTANT: Provide all explanations in German. Adapt validation context to German cultural knowledge and spelling conventions.

Categories and answers to validate:
Player player123:
  Stadt: Aachen
  Land: Australien
  Fluss: Amazon

REQUIRED RESPONSE FORMAT (JSON only):
{
  "player123": {
    "Stadt": {
      "valid": true,
      "score": 20,
      "explanation": "Ausgezeichnet! Aachen ist eine historische deutsche Stadt."
    }
  }
}
```

## Expected Assistant Behavior

### Language-Specific Responses
- **German**: "Ausgezeichnet! Hamburg ist eine große deutsche Stadt."
- **English**: "Excellent! London is a major world capital."
- **French**: "Excellent! Paris est la capitale de la France."
- **Spanish**: "¡Excelente! Madrid es la capital de España."
- **Italian**: "Eccellente! Roma è la capitale d'Italia."
- **Dutch**: "Uitstekend! Amsterdam is de hoofdstad van Nederland."

### Validation Adaptations
- Accept language-appropriate spellings
- Consider cultural context (e.g., German names for cities vs English names)
- Be lenient with regional variants
- Provide educational explanations in the target language

## Testing
After updating the assistant:
1. Create a game room with different languages
2. Submit answers and check that explanations are in the correct language
3. Verify that cultural context is appropriate for the selected language
4. Test with misspellings to ensure 15-point scoring works

## Troubleshooting
- If explanations are still in German for other languages, the assistant instructions may not have been updated properly
- Check the server logs for language being sent: `🌍 Language: en (English)`
- Verify the assistant ID matches: `asst_3Lqlm7XjAeciaGU8VbVOS8Al`

## Benefits
- International players get explanations in their language
- Cultural context appropriate for each language
- Better learning experience for non-German speakers
- More inclusive gameplay experience 