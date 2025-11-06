import type * as Party from "partykit/server";

// Quiz game interfaces
interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

interface QuizTheme {
  primary?: string;
  secondary?: string;
  accent?: string;
  neutral?: string;
  background?: string;
  surface?: string;
  textPrimary?: string;
  textSecondary?: string;
  gradientStart?: string;
  gradientEnd?: string;
  accentGlow?: string;
  secondaryGlow?: string;
  decorative?: string;
  tertiary?: string;
  border?: string;
}

interface Quiz {
  id: string;
  title: string;
  topic: string;
  questions: Question[];
  createdBy: string;
  createdAt: Date;
  isPublic: boolean;
  theme?: QuizTheme;
  metadata?: Record<string, unknown>;
}

interface GeneratedQuizPayload {
  questions: Question[];
  metadata?: Record<string, unknown>;
  theme?: QuizTheme;
  topic?: string;
  title?: string;
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
const POINTS_PER_CORRECT_ANSWER = 100;
const QUIZ_ARCHITECT_PROMPT = `You are an expert quiz architect specializing in creating challenging, intellectually rigorous multiple-choice assessments. Your mission is to generate quizzes that test deep knowledge, critical thinking, and nuanced understanding of specialized topics.

Core Requirements
- Produce only valid JSON using the provided schema.
- Zero answer leakage: questions must not include hints or clues.
- Ensure precise specificity, expert-level depth, contextual complexity, and no obvious eliminations.
- Distractors must be sophisticated, factually grounded, and plausible to partially informed individuals.
- Maintain cognitive rigor distribution: 30% recall, 40% analysis, 20% application, 10% synthesis/evaluation.
- Apply topic-specific calibration rules depending on the subject area.
- Follow the difficulty escalation protocol across question numbers.
- Apply approved question writing techniques and avoid disallowed patterns.
- Validate every fact with at least three authoritative sources and surface them in metadata.

Quality Assurance Checklist
- Expert could plausibly miss the question.
- Tests deep understanding, not rote memorization.
- Options are all plausible without hints.
- Correct answer demands genuine expertise.
- Wrong answer indicates a meaningful knowledge gap.

Output Validation
- Average difficulty rating between 6.5 and 8.5.
- Total of 10-20 questions.
- Facts must be verifiable via provided sources.
- Questions should challenge true experts.

Color Palette Directive
- Populate metadata.color_palette with hex codes (e.g., "#1F1F1F") for: primary, secondary, accent, neutral, background, surface, text_primary, text_secondary, and provide a gradient array containing exactly two color stops.
- Ensure palettes embrace a digital-brutalist aesthetic with bold contrasts and electric highlights while meeting WCAG AA contrast for text against backgrounds.
- Optionally include supporting keys (accent_glow, secondary_glow, decorative, border) to guide UI theming.`;

const HEX_COLOR_REGEX = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

function sanitizeHexColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("#")) return undefined;
  if (!HEX_COLOR_REGEX.test(trimmed)) return undefined;
  if (trimmed.length === 4) {
    return (
      "#" +
      trimmed
        .slice(1)
        .split("")
        .map((ch) => ch + ch)
        .join("")
        .toUpperCase()
    );
  }
  return trimmed.toUpperCase();
}

function extractTheme(palette: any): QuizTheme | undefined {
  if (!palette || typeof palette !== "object") return undefined;
  const gradientArray = Array.isArray(palette.gradient)
    ? palette.gradient
    : Array.isArray(palette.gradient_colors)
    ? palette.gradient_colors
    : [];

  const theme: QuizTheme = {
    primary: sanitizeHexColor(palette.primary),
    secondary: sanitizeHexColor(palette.secondary),
    accent: sanitizeHexColor(palette.accent),
    neutral: sanitizeHexColor(palette.neutral),
    background: sanitizeHexColor(palette.background),
    surface: sanitizeHexColor(palette.surface),
    textPrimary: sanitizeHexColor(palette.text_primary ?? palette.textPrimary),
    textSecondary: sanitizeHexColor(palette.text_secondary ?? palette.textSecondary),
    gradientStart: sanitizeHexColor(palette.gradient_start ?? palette.gradientStart ?? gradientArray[0]),
    gradientEnd: sanitizeHexColor(palette.gradient_end ?? palette.gradientEnd ?? gradientArray[1] ?? gradientArray[0]),
    accentGlow: sanitizeHexColor(palette.accent_glow ?? palette.glow),
    secondaryGlow: sanitizeHexColor(palette.secondary_glow),
    decorative: sanitizeHexColor(palette.decorative ?? palette.grid_line),
    tertiary: sanitizeHexColor(palette.tertiary ?? palette.tertiary_accent ?? palette.secondary_accent),
    border: sanitizeHexColor(palette.border)
  };

  const hasColor = Object.values(theme).some(Boolean);
  return hasColor ? theme : undefined;
}

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

// AI Quiz Generation using OpenAI Responses API
async function generateQuizWithOpenAI(topic: string, questionCount: number = 10): Promise<GeneratedQuizPayload> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error("OpenAI API key not found");
  }

  try {
    console.log("🤖 Generating quiz questions with Responses API for topic:", topic);

    const normalizedQuestionCount = Math.min(Math.max(questionCount, 10), 20);

    const prompt = `${QUIZ_ARCHITECT_PROMPT}

Topic: ${topic}
Requested total questions: ${normalizedQuestionCount}

Instructions:
- Set "topic" to the exact provided topic string.
- Provide ${normalizedQuestionCount} questions following the difficulty escalation protocol.
- Ensure validated_sources contains at least three authoritative references actually used.
- Use ISO 8601 UTC timestamp for metadata.created_at.
- Target audience: pick from knowledgeable enthusiasts, professionals, or experts based on topic sophistication.
- Populate metadata.color_palette with uppercase hex codes for primary, secondary, accent, neutral, background, surface, text_primary, text_secondary, and a gradient array containing exactly two colors.
- Include optional palette helpers (accent_glow, secondary_glow, decorative, border) when they support the visual identity.
- You may use web browsing tools to fact-check and surface current information.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: prompt
              }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Generate the quiz JSON now.`
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_object'
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Responses API error: ${response.status} - ${errorText}`);
    }

    const responseData = await response.json();
    const outputText =
      responseData.output_text ??
      (Array.isArray(responseData.output)
        ? responseData.output
            .flatMap((entry: any) =>
              Array.isArray(entry?.content)
                ? entry.content
                    .filter((c: any) => c.type === 'output_text' || c.type === 'text')
                    .map((c: any) => c.text)
                : []
            )
            .join('')
        : undefined);

    if (!outputText) {
      throw new Error('No output text received from Responses API');
    }

    const quizData = JSON.parse(outputText);
    if (!quizData || !Array.isArray(quizData.questions)) {
      throw new Error('Responses API returned data without a questions array');
    }
    
    // Convert to our Question format
    const questions: Question[] = (quizData.questions || []).map((q: any, index: number) => ({
      id: `q_${Date.now()}_${index}`,
      question: q.question,
      options: q.options,
      correctAnswer: q.correct_answer_index,
      explanation: q.explanation
    }));

    let metadata: Record<string, unknown> | undefined;
    if (quizData.metadata && typeof quizData.metadata === 'object') {
      metadata = { ...quizData.metadata } as Record<string, unknown>;
    }

    const paletteCandidate = metadata && typeof (metadata as any).color_palette === 'object'
      ? (metadata as any).color_palette
      : quizData?.metadata?.color_palette;

    const theme = extractTheme(paletteCandidate);

    if (theme) {
      metadata = metadata ? { ...metadata } : {};
      const existingPalette = metadata && typeof (metadata as any).color_palette === 'object'
        ? (metadata as any).color_palette
        : {};
      (metadata as Record<string, unknown>).color_palette = { ...existingPalette, ...theme };
    }

    console.log(`✅ Generated ${questions.length} questions for topic: ${topic}`);
    if (theme) {
      console.log('🎨 Theme palette generated:', theme);
    }

    return {
      questions,
      metadata,
      theme,
      topic: typeof quizData.topic === 'string' ? quizData.topic : undefined,
      title: typeof quizData.topic === 'string' ? quizData.topic : undefined
    };

  } catch (error) {
    console.error("❌ Error generating quiz:", error);
    throw error;
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
      const { topic, questionCount = 10, title, playerName } = data;
      
      console.log(`🎯 Creating quiz: "${title}" about "${topic}"`);
      
      // Generate questions using AI
      const generated = await generateQuizWithOpenAI(topic, questionCount);
      const questions = generated.questions;
      const metadata: Record<string, unknown> | undefined = generated.metadata
        ? { ...generated.metadata }
        : generated.theme
        ? { color_palette: generated.theme }
        : undefined;
      const resolvedTopic = generated.topic || topic;
      const resolvedTitle = title || generated.title || `Quiz about ${resolvedTopic}`;

      // Create quiz object
      const quiz: Quiz = {
        id: `quiz_${Date.now()}`,
        title: resolvedTitle,
        topic: resolvedTopic,
        questions,
        createdBy: playerName || 'Anonymous',
        createdAt: new Date(),
        isPublic: true,
        theme: generated.theme,
        metadata
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

    const currentQuestion = this.session.quiz.questions[this.session.currentQuestionIndex];
    const isCorrect = answerIndex === currentQuestion.correctAnswer;
    console.log(`📝 ${player.name} answered question ${this.session.currentQuestionIndex} (${isCorrect ? '✅ correct' : '❌ incorrect'})`);
    
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

      if ((!quiz.theme || typeof quiz.theme !== 'object') && quiz.metadata && typeof (quiz.metadata as any).color_palette === 'object') {
        const derivedTheme = extractTheme((quiz.metadata as any).color_palette);
        if (derivedTheme) {
          const existingPalette = (quiz.metadata as any).color_palette || {};
          quiz = {
            ...quiz,
            theme: derivedTheme,
            metadata: {
              ...(quiz.metadata || {}),
              color_palette: { ...existingPalette, ...derivedTheme }
            }
          } as Quiz;
        }
      } else if (quiz.theme && typeof quiz.theme === 'object' && (!quiz.metadata || typeof (quiz.metadata as any).color_palette !== 'object')) {
        quiz = {
          ...quiz,
          metadata: {
            ...(quiz.metadata || {}),
            color_palette: { ...quiz.theme }
          }
        } as Quiz;
      }

      // Store quiz in memory for this session (sanitized copy)
      quizDatabase[quizId] = quiz;
      
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

    const currentQuestion = this.session.quiz.questions[this.session.currentQuestionIndex];

    Object.values(this.session.players).forEach(player => {
      const answer = player.currentAnswer;
      if (answer === currentQuestion.correctAnswer) {
        player.score += POINTS_PER_CORRECT_ANSWER;
        console.log(`✅ ${player.name} earned ${POINTS_PER_CORRECT_ANSWER} points for correct answer`);
      } else {
        console.log(`❌ ${player.name} earned 0 points for incorrect answer`);
      }
    });
    
    // Broadcast results
    this.party.broadcast(JSON.stringify({
      type: 'question_results',
      currentQuestion,
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

    this.broadcastSessionUpdate();
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
