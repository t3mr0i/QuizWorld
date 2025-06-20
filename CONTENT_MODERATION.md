# Content Moderation System

QuizWorld implements a balanced content moderation system to ensure that all quiz content is appropriate and safe for users while allowing creative freedom for legitimate educational and entertainment topics including alcohol, religion, history, and other legal subjects.

## Overview

The content moderation system operates at multiple levels:

1. **Client-side Pre-validation** - Real-time feedback as users type
2. **Server-side Content Filtering** - Pattern-based blocking before AI generation
3. **AI-Guided Moderation** - OpenAI assistant with content guidelines
4. **Post-generation Validation** - Final check on generated questions

## Content Categories

### ✅ **Allowed Content**

- **Educational Topics**: Science, history, literature, mathematics, geography, medicine
- **Entertainment**: Movies, music, TV shows, celebrities, gaming
- **General Knowledge**: Trivia, facts, current events (non-controversial)
- **Culture & Travel**: Food, tourism, traditions (presented respectfully)
- **Nature & Animals**: Wildlife, environment, conservation
- **Technology**: Computers, innovation, programming
- **Sports**: Games, competitions, Olympics
- **Arts**: Painting, sculpture, famous artists
- **Alcohol & Beverages**: Beer history, wine regions, cocktails, brewing, bartending
- **Religion & Mythology**: When presented factually and respectfully
- **Historical Events**: Wars, conflicts (when educational)
- **Medical Topics**: Anatomy, diseases, healthcare (when educational)

### ⚠️ **Contextual Content (Allowed with Educational Context)**

- **Sensitive Historical Topics**: Wars, conflicts (when educational)
- **Political Topics**: Historical politics (non-partisan)
- **Controversial Topics**: When presented with educational framing

### ❌ **Blocked Content**

#### High Severity (Immediately Blocked)
- **Hate Speech**: Racism, sexism, homophobia, transphobia
- **Instructions for Illegal Activities**: How to make bombs, drugs, weapons
- **Explicit Sexual Content**: Hardcore pornography, graphic sexual material
- **Personal Attacks**: Doxxing, harassment, cyberbullying, death threats
- **Direct Harm Instructions**: Content that could cause immediate harm if followed

#### Medium Severity (Blocked without Educational Context)
- **Adult Content**: Without appropriate educational context
- **Highly Controversial Topics**: Without educational framing

## What Changed - Less Strict Filtering

### **Now Allowed:**
- **Alcohol Topics**: "Beer History", "Wine Making", "Famous Cocktails", "Brewery Tours"
- **Religion Topics**: "World Religions", "Greek Mythology", "Religious Art History"
- **Medical Topics**: "Human Anatomy", "History of Medicine", "Disease Prevention"
- **Historical Conflicts**: "World War II", "Civil War History", "Ancient Battles"
- **General Terms**: Topics using words like "war", "conflict", "religion", "medical", "alcohol"

### **Still Blocked:**
- **Illegal Instructions**: "How to make drugs", "Bomb making", "Weapon manufacturing"
- **Hate Speech**: Any discriminatory content
- **Explicit Sexual Content**: Graphic sexual material
- **Direct Harm**: Instructions that could cause immediate harm

## Technical Implementation

### Server-Side Moderation (`ContentModerator`)

**Enhanced Allowed Patterns:**
```typescript
// Now includes alcohol, religion, medical topics as positive context
/\b(alcohol|beer|wine|spirits|brewing|distilling|cocktails|bartending)\b/i,
/\b(religion|religious|mythology|folklore|spiritual|belief)\b/i,
/\b(medicine|healthcare|medical\s*education|health)\b/i
```

**Refined Blocked Patterns:**
```typescript
// Focuses on instructions for illegal activities rather than general terms
/\b(how\s*to\s*murder|how\s*to\s*kill|assassination|murder\s*methods)\b/i,
/\b(how\s*to\s*make\s*drugs|drug\s*manufacturing)\b/i,
/\b(bomb\s*instructions|explosive\s*instructions)\b/i
```

### Client-Side Moderation (`ClientContentModerator`)

**Updated Positive Keywords:**
- Added: `alcohol`, `beer`, `wine`, `spirits`, `brewing`, `cocktails`, `bartending`
- Added: `religion`, `religious`, `mythology`, `cultural`, `tradition`, `festival`
- Added: `medicine`, `healthcare`, `academic`, `learning`

**Refined Blocked Keywords:**
- Removed general terms like: `war`, `conflict`, `religion`, `alcohol`, `medical`
- Added specific harmful instructions: `how to murder`, `how to make drugs`, `bomb instructions`

### AI Integration

The system now provides OpenAI with updated guidelines:

```
EXPLICITLY APPROVED TOPICS (always generate quizzes for these):
- Alcohol and beverages (beer, wine, spirits, cocktails, brewing, history of alcohol)
- Religion and mythology (when presented factually and respectfully)
- Medical topics (anatomy, diseases, healthcare - when educational)
- Historical topics including wars (when educational)

ONLY reject topics that explicitly involve:
- Teaching illegal activities
- Explicit hate speech
- Graphic sexual content
- Direct harm or violence instructions
```

## User Experience

### Real-Time Feedback

- **Green Checkmark**: Topic approved (including alcohol, religion, medical topics)
- **Yellow Warning**: Potentially sensitive, needs educational context
- **Red Block**: Contains illegal instructions or hate speech

### New Suggested Topics

Added alcohol and other previously restricted topics:
- "Beer and Brewing History"
- "Wine Regions of the World" 
- "Cocktail Recipes and Bartending"
- "World Religions and Mythology"
- "Medical Breakthroughs and Healthcare"

## Content Guidelines for Users

### ✅ **Great Quiz Topics**

**Educational & General:**
- "Ancient Civilizations History"
- "Space and Astronomy" 
- "Scientific Discoveries"
- "World Geography and Landmarks"
- "Classic Literature and Authors"

**Entertainment & Culture:**
- "Movie Trivia and Entertainment"
- "Music History and Genres"
- "Sports and Olympics"
- "Video Games and Gaming"

**Food & Beverages:**
- "World Cuisine and Food Culture"
- "Beer and Brewing History"
- "Wine Regions of the World"
- "Famous Cocktails and Bartending"

**Religion & Mythology:**
- "Greek Mythology"
- "World Religions Overview"
- "Religious Art and Architecture"
- "Ancient Mythologies"

**Medical & Health:**
- "Human Anatomy Basics"
- "History of Medicine"
- "Famous Medical Discoveries"
- "Health and Wellness"

**History (Including Conflicts):**
- "World War II History"
- "Ancient Battles and Strategies"
- "Civil Rights Movement"
- "Historical Revolutions"

### 💡 **Tips for Success**

1. **Be Educational**: "History of Beer" vs "Getting Drunk"
2. **Add Context**: "Medical Anatomy" vs "Body Parts"
3. **Stay Factual**: "World Religions" vs "Religious Debate"
4. **Focus on Learning**: "Wine Making Process" vs "Alcohol Effects"
5. **Historical Perspective**: "World War II Facts" vs "How to Fight Wars"

### ❌ **Still Not Allowed**

- **Illegal Instructions**: "How to make explosives", "Drug manufacturing"
- **Hate Speech**: Any discriminatory content
- **Explicit Sexual Content**: Graphic sexual material
- **Harassment**: Personal attacks, doxxing, threats

## Benefits of Less Strict Filtering

### **Enhanced Educational Value**
- More diverse quiz topics
- Better coverage of world cultures
- Inclusion of legitimate adult topics

### **Improved User Experience**
- Fewer false positives
- More creative freedom
- Better topic suggestions

### **Maintained Safety**
- Still blocks truly harmful content
- Protects against illegal instructions
- Prevents hate speech and harassment

## Monitoring and Appeals

### **If Content is Incorrectly Blocked:**
1. Try adding educational context to your topic
2. Use more specific, educational phrasing
3. Check the suggested topics for inspiration
4. Contact support if you believe the filtering is incorrect

### **Examples of Good Rephrasing:**
- "Alcohol" → "History of Alcoholic Beverages"
- "Religion" → "World Religions and Their Traditions"
- "War" → "World War II Historical Facts"
- "Medical" → "Medical Breakthroughs and Discoveries"

The goal remains to maintain a safe, educational, and fun environment while allowing legitimate discussion of adult topics when presented appropriately. 