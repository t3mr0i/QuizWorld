import type * as Party from "partykit/server";

// Quiz game interfaces
interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

interface Quiz {
  id: string;
  title: string;
  topic: string;
  questions: Question[];
  createdBy: string;
  createdAt: Date;
  isPublic: boolean;
  language?: string;
}

interface Player {
  id: string;
  name: string;
  score: number;
  currentAnswer?: number;
  hasAnswered: boolean;
  isReady: boolean;
  isHost: boolean;
}

interface QuizSession {
  id: string;
  quiz: Quiz;
  players: Record<string, Player>;
  currentQuestionIndex: number;
  gameState: 'waiting' | 'playing' | 'question' | 'results' | 'finished';
  host: string;
  answers: Record<string, Record<number, number>>; // playerId -> questionIndex -> answerIndex
  isTournament?: boolean;
  tournamentInfo?: {
    name: string;
    sourceQuizzes: Array<{
      id: string;
      title: string;
      questionCount: number;
    }>;
  };
}

// Store for quiz sessions by room ID
const quizSessions: Record<string, QuizSession> = {};
const quizDatabase: Record<string, Quiz> = {}; // Simple in-memory storage

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// AI Quiz Generation using OpenAI Assistant with robust error handling and retry logic
interface AIRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

interface AIError {
  code: string;
  message: string;
  type: 'rate_limit' | 'auth' | 'server' | 'timeout' | 'parse' | 'unknown';
  retryable: boolean;
}

const AI_RETRY_CONFIG: AIRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

class AIService {
  private static instance: AIService;
  private apiKey: string;
  private assistantId: string;

  private constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.assistantId = process.env.OPENAI_ASSISTANT_ID || "asst_ApGsn7wfvZBukHPW9l4rMjn0";
  
    if (!this.apiKey) {
      console.error('❌ SECURITY WARNING: OPENAI_API_KEY not configured');
      throw new Error('AI service not properly configured');
  }

    // Validate API key format (basic security check)
    if (!this.apiKey.startsWith('sk-')) {
      console.error('❌ SECURITY WARNING: Invalid API key format');
      throw new Error('Invalid API key format');
    }
  }

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private calculateBackoffDelay(attempt: number, config: AIRetryConfig): number {
    const delay = Math.min(
      config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
      config.maxDelayMs
    );
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  private parseAIError(error: any): AIError {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      switch (status) {
        case 401:
          return {
            code: 'AUTH_ERROR',
            message: 'Invalid API key or unauthorized access',
            type: 'auth',
            retryable: false
          };
        case 429:
          return {
            code: 'RATE_LIMIT',
            message: 'API rate limit exceeded',
            type: 'rate_limit',
            retryable: true
          };
        case 500:
        case 502:
        case 503:
        case 504:
          return {
            code: 'SERVER_ERROR',
            message: `OpenAI server error: ${status}`,
            type: 'server',
            retryable: true
          };
        case 408:
          return {
            code: 'TIMEOUT',
            message: 'Request timeout',
            type: 'timeout',
            retryable: true
          };
        default:
          return {
            code: 'API_ERROR',
            message: data?.error?.message || `HTTP ${status}`,
            type: 'unknown',
            retryable: status >= 500
          };
      }
    }
    
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return {
        code: 'TIMEOUT',
        message: 'Request timed out',
        type: 'timeout',
        retryable: true
      };
    }
    
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'Unknown error occurred',
      type: 'unknown',
      retryable: true
    };
  }

  private async makeSecureRequest(url: string, options: RequestInit, timeoutMs: number = 30000): Promise<Response> {
    // Create an abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      // Ensure no API key leakage in logs
      const secureOptions = {
        ...options,
        signal: controller.signal,
      headers: {
          ...options.headers,
          'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2',
          'User-Agent': 'QuizWorld/1.0'
        }
      };

      const response = await fetch(url, secureOptions);
      clearTimeout(timeoutId);
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async retryableRequest<T>(
    operation: () => Promise<T>,
    operationName: string,
    config: AIRetryConfig = AI_RETRY_CONFIG
  ): Promise<T> {
    let lastError: AIError | null = null;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        console.log(`🔄 ${operationName} - Attempt ${attempt + 1}/${config.maxRetries + 1}`);
        return await operation();
      } catch (error) {
        lastError = this.parseAIError(error);
        
        console.warn(`⚠️ ${operationName} failed (attempt ${attempt + 1}):`, {
          code: lastError.code,
          message: lastError.message,
          type: lastError.type,
          retryable: lastError.retryable
        });
        
        // Don't retry if error is not retryable or we're on the last attempt
        if (!lastError.retryable || attempt === config.maxRetries) {
          break;
        }
        
        // Calculate and apply backoff delay
        const delayMs = this.calculateBackoffDelay(attempt, config);
        console.log(`⏳ Waiting ${delayMs}ms before retry...`);
        await this.delay(delayMs);
      }
    }
    
    // All retries exhausted
    const errorMessage = lastError 
      ? `${lastError.code}: ${lastError.message}`
      : 'Unknown error after all retries';
    
    console.error(`❌ ${operationName} failed after ${config.maxRetries + 1} attempts:`, errorMessage);
    throw new Error(errorMessage);
  }

  async generateQuiz(topic: string, questionCount: number = 10, language: string = 'en'): Promise<Question[]> {
    console.log(`🤖 Starting AI quiz generation for topic: "${topic}" (${questionCount} questions)`);
    
    try {
      let threadId: string | null = null;
      
      try {
        // Step 1: Create thread with retry logic
        threadId = await this.retryableRequest(async () => {
          const response = await this.makeSecureRequest('https://api.openai.com/v1/threads', {
            method: 'POST',
      body: JSON.stringify({})
    });

          if (!response.ok) {
            throw { response };
          }
          
          const thread = await response.json();
          return thread.id;
        }, 'Create Thread');
        
        console.log(`✅ Thread created: ${threadId}`);
        
                 // Step 2: Add message with content moderation and generation prompt
         await this.retryableRequest(async () => {
           const moderationPrompt = ContentModerator.generateAIModerationPrompt(topic);
           
           // Determine language instructions
           let languageInstruction = '';
           if (language && language !== 'en') {
             const languageMap: Record<string, string> = {
               'es': 'Spanish',
               'fr': 'French', 
               'de': 'German',
               'it': 'Italian',
               'nl': 'Dutch',
               'pt': 'Portuguese',
               'ja': 'Japanese',
               'ko': 'Korean',
               'zh': 'Chinese',
               'ru': 'Russian',
               'ar': 'Arabic',
               'hi': 'Hindi'
             };
             
             const languageName = languageMap[language] || language;
             languageInstruction = `\n\nIMPORTANT: Generate ALL content (questions, options, explanations) in ${languageName}. Use proper grammar and natural language for native speakers.`;
           }
           
           const generationPrompt = `${moderationPrompt}

Generate a ${questionCount}-question quiz about "${topic}". Each question should:
1. Have exactly 4 multiple choice options (A, B, C, D)
2. Be educational and appropriate for all audiences
3. Focus on factual, verifiable information
4. Avoid controversial or sensitive topics
5. Be engaging and fun to answer${languageInstruction}

Return ONLY valid JSON in this exact format:
{
  "questions": [
    {
      "question": "What is the capital of France?",
      "options": ["London", "Berlin", "Paris", "Madrid"],
      "correct_answer_index": 2,
      "explanation": "Paris has been the capital of France since 987 AD."
    }
  ]
}`;

           const response = await this.makeSecureRequest(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: 'user',
               content: generationPrompt
      })
    });

           if (!response.ok) {
             throw { response };
           }
           
           return response.json();
         }, 'Add Message');
        
        console.log(`✅ Message added to thread`);

        // Step 3: Run assistant with retry logic
        const runId = await this.retryableRequest(async () => {
          const response = await this.makeSecureRequest(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      body: JSON.stringify({
              assistant_id: this.assistantId
      })
    });

          if (!response.ok) {
            throw { response };
          }
          
          const run = await response.json();
          return run.id;
        }, 'Run Assistant');
        
        console.log(`✅ Assistant run started: ${runId}`);
    
        // Step 4: Poll for completion with enhanced timeout logic
        const result = await this.retryableRequest(async () => {
          const maxAttempts = 60; // 60 seconds max
    let attempts = 0;
          
          while (attempts < maxAttempts) {
            const response = await this.makeSecureRequest(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
              method: 'GET'
      });
      
            if (!response.ok) {
              throw { response };
            }
            
            const statusData = await response.json();
            const status = statusData.status;
            
            console.log(`📊 Run status: ${status} (attempt ${attempts + 1}/${maxAttempts})`);
            
            if (status === 'completed') {
              return 'completed';
            } else if (status === 'failed' || status === 'cancelled' || status === 'expired') {
              throw new Error(`Assistant run failed with status: ${status}`);
            }
            
      attempts++;
            await this.delay(1000);
          }
          
          throw new Error('Assistant run timeout - exceeded maximum wait time');
        }, 'Wait for Completion');
        
        console.log(`✅ Assistant run completed`);
        
        // Step 5: Get messages with retry logic
        const content = await this.retryableRequest(async () => {
          const response = await this.makeSecureRequest(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            method: 'GET'
    });

          if (!response.ok) {
            throw { response };
    }

          const messages = await response.json();
    const assistantMessage = messages.data.find((msg: any) => msg.role === 'assistant');
    
    if (!assistantMessage || !assistantMessage.content[0]?.text?.value) {
            throw new Error('No valid response from assistant');
    }

          return assistantMessage.content[0].text.value;
        }, 'Get Messages');
        
        console.log(`✅ Retrieved assistant response`);
    
                 // Step 6: Parse and validate response
         const questions = await this.retryableRequest(async () => {
           try {
             // Check if AI explicitly refused to generate content due to moderation
             if (content.includes('"error": "inappropriate_content"') || 
                 (content.includes('violates content guidelines') && content.includes('error'))) {
               
               // Create a more specific error for content moderation
               const moderationError = new Error('CONTENT_MODERATION_FAILED');
               (moderationError as any).isContentModerationError = true;
               (moderationError as any).userMessage = 'This topic violates content guidelines. Please try a different topic like science, history, entertainment, or general knowledge.';
               throw moderationError;
             }
             
    const quizData = JSON.parse(content);
    
             if (!quizData.questions || !Array.isArray(quizData.questions)) {
               throw new Error('Invalid quiz data structure');
             }
             
             const questions: Question[] = quizData.questions.map((q: any, index: number) => {
               if (!q.question || !q.options || !Array.isArray(q.options) || q.options.length !== 4) {
                 throw new Error(`Invalid question structure at index ${index}`);
               }
               
               const correctAnswer = typeof q.correct_answer_index === 'number' 
                 ? q.correct_answer_index 
                 : parseInt(q.correct_answer_index);
               
               if (isNaN(correctAnswer) || correctAnswer < 0 || correctAnswer >= q.options.length) {
                 throw new Error(`Invalid correct answer index at question ${index}`);
               }
               
               // Additional content validation on each question
               const questionText = String(q.question).trim();
               const allOptions = q.options.map((opt: any) => String(opt).trim()).join(' ');
               const explanation = q.explanation ? String(q.explanation).trim() : '';
               const fullQuestionContent = `${questionText} ${allOptions} ${explanation}`;
               
               const questionModeration = ContentModerator.moderateContent(fullQuestionContent);
               if (!questionModeration.isAllowed) {
                 console.warn(`❌ Question ${index + 1} failed content moderation:`, questionModeration.reason);
                 throw new Error(`Generated question contains inappropriate content: ${questionModeration.reason}`);
               }
               
               return {
      id: `q_${Date.now()}_${index}`,
                 question: questionText,
                 options: q.options.map((opt: any) => String(opt).trim()),
                 correctAnswer,
                 explanation: explanation || undefined
               };
             });
             
             if (questions.length === 0) {
               throw new Error('No valid questions generated');
             }

             console.log(`✅ Content validation passed for ${questions.length} questions`);
    return questions;
           } catch (parseError) {
             console.error('❌ Failed to parse AI response:', parseError);
             console.error('Raw response (first 500 chars):', content.substring(0, 500) + '...');
             throw new Error(`Failed to parse AI response: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
           }
         }, 'Parse Response');
        
        console.log(`✅ Successfully generated ${questions.length} questions for topic: "${topic}"`);
        return questions;
        
      } finally {
        // Clean up thread regardless of success or failure
        if (threadId) {
          try {
            await this.makeSecureRequest(`https://api.openai.com/v1/threads/${threadId}`, {
              method: 'DELETE'
            });
            console.log(`🗑️ Thread ${threadId} cleaned up`);
          } catch (cleanupError) {
            console.warn(`⚠️ Failed to cleanup thread ${threadId}:`, cleanupError);
          }
        }
      }
  } catch (error) {
      console.error(`❌ Quiz generation failed for topic "${topic}":`, error);
      throw new Error(`Failed to generate quiz: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Factory function to get AI service instance
async function generateQuizWithOpenAI(topic: string, questionCount: number = 10, language: string = 'en'): Promise<Question[]> {
  const aiService = AIService.getInstance();
  return await aiService.generateQuiz(topic, questionCount, language);
}

// Content Moderation System
interface ContentModerationResult {
  isAllowed: boolean;
  reason?: string;
  suggestion?: string;
  severity: 'low' | 'medium' | 'high';
}

class ContentModerator {
  private static readonly BLOCKED_PATTERNS = [
    // Hate speech and discrimination
    /\b(racist?|racism|nazi|hitler|supremacist|genocide|ethnic\s*cleansing)\b/i,
    /\b(sexist|misogyn|incel|femoid|chad|beta\s*male)\b/i,
    /\b(homophob|transphob|f[a4]gg[o0]t|tr[a4]nny|dyke)\b/i,
    /\b(terrorist|jihad|isis|al\s*qaeda|bomb\s*making|how\s*to\s*make\s*bomb)\b/i,
    
    // Explicit sexual content
    /\b(porn|xxx|hardcore\s*sex|nude\s*photos|naked\s*pics|erotic\s*images|fetish\s*porn|bdsm\s*porn)\b/i,
    /\b(masturbat|orgasm|explicit\s*sexual|sexual\s*acts)\b/i,
    
    // Illegal violence and truly harmful activities
    /\b(how\s*to\s*murder|how\s*to\s*kill|assassination|murder\s*methods)\b/i,
    /\b(illegal\s*drug\s*making|how\s*to\s*make\s*drugs|drug\s*manufacturing|cocaine\s*production|heroin\s*production|methamphetamine\s*production)\b/i,
    /\b(illegal\s*weapons|how\s*to\s*make\s*weapons|bomb\s*instructions|explosive\s*instructions)\b/i,
    /\b(how\s*to\s*hack|illegal\s*hacking|credit\s*card\s*fraud|identity\s*theft)\b/i,
    
    // Personal attacks and doxxing
    /\b(doxx|dox|personal\s*info|address|phone\s*number|home\s*address)\b/i,
    /\b(cyberbully|harassment|stalking|threaten|death\s*threat)\b/i
  ];

  private static readonly FLAGGED_PATTERNS = [
    // Potentially sensitive but often educational - require context
    /\b(war|conflict|battle|revolution|protest|civil\s*war)\b/i,
    /\b(politics|democrat|republican|conservative|liberal|political\s*party)\b/i,
    /\b(controversial|sensitive\s*topic|adult\s*content)\b/i
  ];

  private static readonly POSITIVE_CONTEXT_PATTERNS = [
    // Educational contexts that make flagged content acceptable
    /\b(history|historical|world\s*war|civil\s*war|educational|academic|learning)\b/i,
    /\b(science|biology|anatomy|medical\s*education|health|healthcare|medicine)\b/i,
    /\b(geography|countries|cultures|traditions|cultural|anthropology)\b/i,
    /\b(literature|books|novels|poetry|art|philosophy|sociology)\b/i,
    /\b(movies|films|tv\s*shows|entertainment|celebrities|music|bands|artists)\b/i,
    /\b(sports|games|olympics|championship|competition|athletics)\b/i,
    /\b(food|cooking|recipes|cuisine|restaurants|culinary|gastronomy)\b/i,
    /\b(travel|tourism|destinations|landmarks|world\s*heritage)\b/i,
    /\b(technology|computers|programming|innovation|engineering)\b/i,
    /\b(nature|animals|environment|conservation|wildlife|ecology)\b/i,
    /\b(religion|religious|mythology|folklore|spiritual|belief)\b/i,
    /\b(alcohol|beer|wine|spirits|brewing|distilling|cocktails|bartending)\b/i,
    /\b(festival|celebration|holiday|tradition|custom|ritual)\b/i,
    /\b(quiz|trivia|knowledge|facts|information|general\s*knowledge)\b/i
  ];

  static moderateContent(topic: string, title?: string): ContentModerationResult {
    const fullText = `${topic} ${title || ''}`.toLowerCase().trim();
    
    // Check for blocked content (truly inappropriate/illegal)
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(fullText)) {
        return {
          isAllowed: false,
          reason: 'This topic contains content that violates our community guidelines.',
          suggestion: 'Try a different topic like science, history, entertainment, or general knowledge.',
          severity: 'high'
        };
      }
    }
    
    // Check for flagged content (potentially sensitive but often legitimate)
    const flaggedMatches = this.FLAGGED_PATTERNS.filter(pattern => pattern.test(fullText));
    if (flaggedMatches.length > 0) {
      // Check if there's positive educational context
      const hasPositiveContext = this.POSITIVE_CONTEXT_PATTERNS.some(pattern => pattern.test(fullText));
      
      if (!hasPositiveContext) {
        return {
          isAllowed: false,
          reason: 'This topic may be sensitive. Consider adding educational context.',
          suggestion: 'Try adding educational context like "History of..." or "Science of..." to make the topic more appropriate.',
          severity: 'medium'
        };
      }
      
      // Allow but with educational context
      console.log(`📚 Educational content approved: "${topic}" (flagged but has positive context)`);
    }
    
    // Additional AI-based moderation prompt
    const aiModerationPrompt = this.generateAIModerationPrompt(topic, title);
    
    return {
      isAllowed: true,
      reason: 'Content approved',
      severity: 'low'
    };
  }

  static generateAIModerationPrompt(topic: string, title?: string): string {
    return `
CONTENT MODERATION: Before generating quiz questions, verify this topic is appropriate:
Topic: "${topic}"
Title: "${title || 'N/A'}"

STRICT GUIDELINES - ONLY reject if the topic involves:
1. Hate speech, discrimination, or offensive content targeting any group
2. Explicit sexual content or graphic sexual material
3. Instructions for illegal activities or violence (how to make bombs, drugs, weapons)
4. Personal attacks, doxxing, or harassment
5. Content that could cause direct harm if followed

EXPLICITLY APPROVED TOPICS (always generate quizzes for these):
- Music artists, bands, musicians, singers (any artist or musical topic)
- Movies, TV shows, entertainment, celebrities, actors
- Sports teams, athletes, games, competitions, olympics
- Science, technology, nature, animals, space, physics, chemistry
- History, geography, cultures, countries, historical events
- Literature, books, authors, poetry, philosophy
- Art, artists, paintings, sculptures, museums
- Food, cooking, restaurants, cuisine, culinary traditions
- Travel, destinations, landmarks, world heritage sites
- Video games, gaming, board games, puzzles
- Educational topics and general knowledge
- Alcohol and beverages (beer, wine, spirits, cocktails, brewing, history of alcohol)
- Religion and mythology (when presented factually and respectfully)
- Medical topics (anatomy, diseases, healthcare - when educational)
- Legal recreational activities and hobbies

IMPORTANT CLARIFICATIONS:
- Alcohol-related topics are APPROVED (beer history, wine regions, cocktail recipes, etc.)
- Historical topics including wars are APPROVED when educational
- Religious topics are APPROVED when respectful and factual
- Medical topics are APPROVED when educational
- Entertainment topics are ALWAYS APPROVED

ONLY reject topics that explicitly involve:
- Teaching illegal activities
- Explicit hate speech
- Graphic sexual content
- Direct harm or violence instructions

For all other topics, proceed with quiz generation.
`;
  }

  static getContentGuidelines(): string[] {
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

export default class QuizaruServer implements Party.Server {
  private roomId: string;

  constructor(readonly party: Party.Party) {
    this.roomId = this.party.id;
  }

  private get session(): QuizSession | undefined {
    return quizSessions[this.roomId];
  }

  async onStart() {
    console.log(`🎯 Quiz room ${this.roomId} started`);
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`👤 Player ${conn.id} connected to quiz room ${this.roomId}`);
    
    // Send current session state if it exists
    if (this.session) {
      conn.send(JSON.stringify({
        type: 'session_state',
        session: this.session
      }));
    }
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message);
      console.log(`📨 Message from ${sender.id}:`, data.type);

      switch (data.type) {
        case 'create_quiz':
          await this.handleCreateQuiz(data, sender);
          break;
        case 'create_tournament':
          await this.handleCreateTournament(data, sender);
          break;
        case 'join_session':
          this.handleJoinSession(data, sender);
          break;
        case 'start_quiz':
          this.handleStartQuiz(sender);
          break;
        case 'submit_answer':
          this.handleSubmitAnswer(data, sender);
          break;
        case 'next_question':
          this.handleNextQuestion(sender);
          break;
        case 'player_ready':
          this.handlePlayerReady(data, sender);
          break;
        case 'get_quiz':
          this.handleGetQuiz(data, sender);
          break;
        case 'play_existing_quiz':
          console.log(`🎯 Received play_existing_quiz message from ${sender.id}`);
          await this.handlePlayExistingQuiz(data, sender);
          break;
        default:
          console.warn(`❓ Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error("❌ Error processing message:", error);
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message'
      }));
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`👋 Player ${conn.id} disconnected from quiz room ${this.roomId}`);
    
    if (this.session && this.session.players[conn.id]) {
      delete this.session.players[conn.id];
      
      // If host left, assign new host
      if (this.session.host === conn.id) {
        const remainingPlayers = Object.keys(this.session.players);
        if (remainingPlayers.length > 0) {
          this.session.host = remainingPlayers[0];
          this.session.players[this.session.host].isHost = true;
        }
      }
      
      this.broadcastSessionUpdate();
    }
  }

  async onRequest(req: Party.Request) {
    const url = new URL(req.url);
    
    // Handle API endpoints
    if (url.pathname.startsWith('/api/')) {
      return this.handleApiRequest(req);
    }
    
    // Serve static files (fallback to existing logic)
    return new Response("Not found", { status: 404 });
  }

  private async handleCreateQuiz(data: any, sender: Party.Connection) {
    try {
      const { topic, questionCount = 10, title, playerName, language = 'en' } = data;
      
      console.log(`🎯 Creating quiz: "${title}" about "${topic}" in ${language}`);
      
      // Moderate content
      const moderationResult = ContentModerator.moderateContent(topic, title);
      
      if (!moderationResult.isAllowed) {
        console.warn(`❌ Content moderation failed:`, moderationResult);
        sender.send(JSON.stringify({
          type: 'error',
          message: moderationResult.reason || 'Content moderation failed'
        }));
        return;
      }
      
      // Generate questions using AI
      const questions = await generateQuizWithOpenAI(topic, questionCount, language);
      
      // Create quiz object
      const quiz: Quiz = {
        id: `quiz_${Date.now()}`,
        title: title || `Quiz about ${topic}`,
        topic,
        questions,
        createdBy: playerName || 'Anonymous',
        createdAt: new Date(),
        isPublic: true,
        language
      };
      
      // Store quiz in memory
      quizDatabase[quiz.id] = quiz;
      
      // Create quiz session
      const session: QuizSession = {
        id: this.roomId,
        quiz,
        players: {
          [sender.id]: {
            id: sender.id,
            name: playerName || 'Host',
            score: 0,
            hasAnswered: false,
            isReady: false,
            isHost: true
          }
        },
        currentQuestionIndex: -1,
        gameState: 'waiting',
        host: sender.id,
        answers: {}
      };
      
      quizSessions[this.roomId] = session;
      
      console.log(`✅ Quiz created with ${questions.length} questions`);
      
      // Send success response
      sender.send(JSON.stringify({
        type: 'quiz_created',
        quiz,
        sessionId: this.roomId
      }));
      
      this.broadcastSessionUpdate();
      
    } catch (error) {
      console.error("❌ Error creating quiz:", error);
      
      // Check if this is a content moderation error
      if ((error as any)?.isContentModerationError) {
        sender.send(JSON.stringify({
          type: 'error',
          message: (error as any).userMessage || 'This topic violates content guidelines. Please try a different topic.'
        }));
        return;
      }
      
      // Check if error message contains content moderation info
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('CONTENT_MODERATION_FAILED') || 
          errorMessage.includes('content guidelines') || 
          errorMessage.includes('inappropriate content')) {
        sender.send(JSON.stringify({
          type: 'error',
          message: 'This topic violates content guidelines. Please try a different topic like science, history, entertainment, or general knowledge.'
        }));
        return;
      }
      
      // Generic error for other issues
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Failed to create quiz. Please try again.'
      }));
    }
  }

  private async handleCreateTournament(data: any, sender: Party.Connection) {
    try {
      const { tournament, playerName } = data;
      const { name, createdBy, combinedQuiz } = tournament;
      
      console.log(`🏆 Creating tournament: "${name}" with ${combinedQuiz.questions.length} questions`);
      
      // Store tournament quiz in memory
      quizDatabase[combinedQuiz.id] = combinedQuiz;
      
      // Create tournament session
      const session: QuizSession = {
        id: this.roomId,
        quiz: combinedQuiz,
        players: {
          [sender.id]: {
            id: sender.id,
            name: playerName || 'Tournament Host',
            score: 0,
            hasAnswered: false,
            isReady: false,
            isHost: true
          }
        },
        currentQuestionIndex: -1,
        gameState: 'waiting',
        host: sender.id,
        answers: {},
        isTournament: true,
        tournamentInfo: {
          name,
          sourceQuizzes: combinedQuiz.sourceQuizzes || []
        }
      };
      
      quizSessions[this.roomId] = session;
      
      console.log(`✅ Tournament created with ${combinedQuiz.questions.length} questions from ${combinedQuiz.sourceQuizzes?.length || 0} quizzes`);
      
      // Send success response
      sender.send(JSON.stringify({
        type: 'tournament_created',
        quiz: combinedQuiz,
        sessionId: this.roomId,
        tournamentInfo: session.tournamentInfo
      }));
      
      this.broadcastSessionUpdate();
      
    } catch (error) {
      console.error("❌ Error creating tournament:", error);
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Failed to create tournament. Please try again.'
      }));
    }
  }

  private handleJoinSession(data: any, sender: Party.Connection) {
    if (!this.session) {
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Quiz session not found'
      }));
      return;
    }

    const { playerName } = data;
    
    // Add player to session
    this.session.players[sender.id] = {
      id: sender.id,
      name: playerName || `Player ${Object.keys(this.session.players).length + 1}`,
      score: 0,
      hasAnswered: false,
      isReady: false,
      isHost: false
    };

    console.log(`👤 ${playerName} joined quiz session ${this.roomId}`);
    
    this.broadcastSessionUpdate();
  }

  private handleStartQuiz(sender: Party.Connection) {
    if (!this.session || this.session.host !== sender.id) {
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Only the host can start the quiz'
      }));
      return;
    }

    const players = Object.values(this.session.players);
    const playerCount = players.length;
    
    // Check if quiz can be started
    // Allow starting with 1 player (solo mode) or when all players are ready
    if (playerCount === 0) {
      sender.send(JSON.stringify({
        type: 'error',
        message: 'No players in the session'
      }));
      return;
    }
    
    if (playerCount > 1) {
      const allReady = players.every(p => p.isReady);
      if (!allReady) {
        sender.send(JSON.stringify({
          type: 'error',
          message: 'All players must be ready before starting'
        }));
        return;
      }
    }

    this.session.gameState = 'playing';
    this.session.currentQuestionIndex = 0;
    
    // Reset all players
    Object.values(this.session.players).forEach(player => {
      player.hasAnswered = false;
      player.score = 0;
    });
    
    console.log(`🚀 Quiz started in room ${this.roomId} with ${playerCount} player(s)`);
    
    this.broadcastSessionUpdate();
  }

  private handleSubmitAnswer(data: any, sender: Party.Connection) {
    if (!this.session || this.session.gameState !== 'playing') {
      return;
    }

    const { answerIndex } = data;
    const player = this.session.players[sender.id];
    
    if (!player || player.hasAnswered) {
      return;
    }

    // Record answer
    if (!this.session.answers[sender.id]) {
      this.session.answers[sender.id] = {};
    }
    
    this.session.answers[sender.id][this.session.currentQuestionIndex] = answerIndex;
    player.hasAnswered = true;
    player.currentAnswer = answerIndex;

    // Calculate score: Fixed 100 points per correct answer (no time bonus)
    const currentQuestion = this.session.quiz.questions[this.session.currentQuestionIndex];
    if (answerIndex === currentQuestion.correctAnswer) {
      const POINTS_PER_CORRECT_ANSWER = 100;
      player.score += POINTS_PER_CORRECT_ANSWER;
      console.log(`✅ ${player.name} earned ${POINTS_PER_CORRECT_ANSWER} points for correct answer`);
    } else {
      console.log(`❌ ${player.name} earned 0 points for incorrect answer`);
    }

    console.log(`📝 ${player.name} answered question ${this.session.currentQuestionIndex}`);
    
    this.broadcastSessionUpdate();
    
    // Check if all players have answered
    const allAnswered = Object.values(this.session.players).every(p => p.hasAnswered);
    if (allAnswered) {
      this.showQuestionResults();
    }
  }

  private handleNextQuestion(sender: Party.Connection) {
    if (!this.session || this.session.host !== sender.id) {
      return;
    }

    this.session.currentQuestionIndex++;
    
    if (this.session.currentQuestionIndex >= this.session.quiz.questions.length) {
      // Quiz finished
      this.session.gameState = 'finished';
      console.log(`🏁 Quiz finished in room ${this.roomId}`);
      
      // Send final results
      this.party.broadcast(JSON.stringify({
        type: 'quiz_finished',
        playerAnswers: Object.fromEntries(
          Object.entries(this.session.players).map(([id, player]) => [
            id, 
            {
              name: player.name,
              score: player.score
            }
          ])
        )
      }));
    } else {
      // Next question
      this.session.gameState = 'playing';
      
      // Reset player answers
      Object.values(this.session.players).forEach(player => {
        player.hasAnswered = false;
        player.currentAnswer = undefined;
      });
    }
    
    this.broadcastSessionUpdate();
  }

  private handlePlayerReady(data: any, sender: Party.Connection) {
    if (!this.session || !this.session.players[sender.id]) {
      return;
    }

    this.session.players[sender.id].isReady = data.ready;
    this.broadcastSessionUpdate();
  }

  private handleGetQuiz(data: any, sender: Party.Connection) {
    const { quizId } = data;
    const quiz = quizDatabase[quizId];
    
    if (quiz) {
      sender.send(JSON.stringify({
        type: 'quiz_data',
        quiz
      }));
    } else {
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Quiz not found'
      }));
    }
  }

  private async handlePlayExistingQuiz(data: any, sender: Party.Connection) {
    try {
      const { quizId, quiz: quizData, playerName } = data;
      
      console.log(`🎮 Loading existing quiz: ${quizId} for player: ${playerName}`);
      console.log(`📊 Quiz data received:`, quizData ? 'YES' : 'NO');
      console.log(`📊 Quiz data keys:`, quizData ? Object.keys(quizData) : 'N/A');
      
      // Use the quiz data sent from client, or fall back to memory
      let quiz = quizData || quizDatabase[quizId];
      
      if (!quiz) {
        sender.send(JSON.stringify({
          type: 'error',
          message: 'Quiz not found. Please try again.'
        }));
        return;
      }
      
      // Store quiz in memory for this session
      if (quizData) {
        quizDatabase[quizId] = quizData;
      }
      
      // Create quiz session with the existing quiz
      const session: QuizSession = {
        id: this.roomId,
        quiz,
        players: {
          [sender.id]: {
            id: sender.id,
            name: playerName || 'Host',
            score: 0,
            hasAnswered: false,
            isReady: false,
            isHost: true
          }
        },
        currentQuestionIndex: -1,
        gameState: 'waiting',
        host: sender.id,
        answers: {}
      };
      
      quizSessions[this.roomId] = session;
      
      console.log(`✅ Existing quiz loaded: "${quiz.title}" with ${quiz.questions.length} questions`);
      
      // Send success response
      sender.send(JSON.stringify({
        type: 'quiz_loaded',
        quiz,
        sessionId: this.roomId,
        session
      }));
      
      this.broadcastSessionUpdate();
      
    } catch (error) {
      console.error("❌ Error loading existing quiz:", error);
      sender.send(JSON.stringify({
        type: 'error',
        message: 'Failed to load quiz. Please try again.'
      }));
    }
  }

  // Timer functionality removed - unlimited time per answer

  private showQuestionResults() {
    if (!this.session) return;
    
    this.session.gameState = 'results';
    
    // Broadcast results
    this.party.broadcast(JSON.stringify({
      type: 'question_results',
      currentQuestion: this.session.quiz.questions[this.session.currentQuestionIndex],
      playerAnswers: Object.fromEntries(
        Object.entries(this.session.players).map(([id, player]) => [
          id, 
          {
            name: player.name,
            answer: player.currentAnswer,
            score: player.score
          }
        ])
      )
    }));
  }

  private broadcastSessionUpdate() {
    if (!this.session) return;
    
    this.party.broadcast(JSON.stringify({
      type: 'session_update',
      session: this.session
    }));
  }

  private async handleApiRequest(req: Party.Request): Promise<Response> {
    const url = new URL(req.url);
    
    if (url.pathname === '/api/quizzes' && req.method === 'GET') {
      // Return list of public quizzes
      const publicQuizzes = Object.values(quizDatabase)
        .filter(quiz => quiz.isPublic)
        .map(quiz => ({
          id: quiz.id,
          title: quiz.title,
          topic: quiz.topic,
          questionCount: quiz.questions.length,
          createdAt: quiz.createdAt,
          createdBy: quiz.createdBy,
          language: quiz.language,
          questions: quiz.questions // Include questions for compatibility
        }));
      
      return new Response(JSON.stringify(publicQuizzes), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response("Not found", { status: 404 });
  }
}
