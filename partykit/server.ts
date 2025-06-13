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

  async generateQuiz(topic: string, questionCount: number = 10): Promise<Question[]> {
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
        
        // Step 2: Add message with retry logic
        await this.retryableRequest(async () => {
          const response = await this.makeSecureRequest(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
              role: 'user',
              content: `Generate a quiz about "${topic}" with ${questionCount} questions. Each question should have 4 multiple choice options. Return ONLY valid JSON in the specified format.`
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
              
              return {
                id: `q_${Date.now()}_${index}`,
                question: String(q.question).trim(),
                options: q.options.map((opt: any) => String(opt).trim()),
                correctAnswer,
                explanation: q.explanation ? String(q.explanation).trim() : undefined
              };
            });
            
            if (questions.length === 0) {
              throw new Error('No valid questions generated');
            }
            
            return questions;
          } catch (parseError) {
            console.error('❌ Failed to parse AI response:', parseError);
            console.error('Raw response:', content.substring(0, 500) + '...');
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
async function generateQuizWithOpenAI(topic: string, questionCount: number = 10): Promise<Question[]> {
  const aiService = AIService.getInstance();
  return await aiService.generateQuiz(topic, questionCount);
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
      const { topic, questionCount = 10, title, playerName } = data;
      
      console.log(`🎯 Creating quiz: "${title}" about "${topic}"`);
      
      // Generate questions using AI
      const questions = await generateQuizWithOpenAI(topic, questionCount);
      
      // Create quiz object
      const quiz: Quiz = {
        id: `quiz_${Date.now()}`,
        title: title || `Quiz about ${topic}`,
        topic,
        questions,
        createdBy: playerName || 'Anonymous',
        createdAt: new Date(),
        isPublic: true
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
          createdAt: quiz.createdAt
        }));
      
      return new Response(JSON.stringify(publicQuizzes), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response("Not found", { status: 404 });
  }
}
