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
  questionStartTime?: Date;
  questionTimeLimit: number; // seconds
  host: string;
  answers: Record<string, Record<number, number>>; // playerId -> questionIndex -> answerIndex
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

// AI Quiz Generation using OpenAI Assistant
async function generateQuizWithOpenAI(topic: string, questionCount: number = 10): Promise<Question[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const assistantId = "asst_ApGsn7wfvZBukHPW9l4rMjn0";
  
  if (!apiKey) {
    throw new Error("OpenAI API key not found");
  }

  try {
    console.log("🤖 Generating quiz questions for topic:", topic);
    
    // Create a thread
    const threadResponse = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({})
    });

    if (!threadResponse.ok) {
      throw new Error(`Failed to create thread: ${threadResponse.status}`);
    }

    const thread = await threadResponse.json();
    
    // Add message to thread
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        role: 'user',
        content: `${topic}`
      })
    });

    if (!messageResponse.ok) {
      throw new Error(`Failed to add message: ${messageResponse.status}`);
    }

    // Run the assistant
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: assistantId
      })
    });

    if (!runResponse.ok) {
      throw new Error(`Failed to run assistant: ${runResponse.status}`);
    }

    const run = await runResponse.json();
    
    // Poll for completion
    let runStatus = run.status;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    
    while (runStatus === 'queued' || runStatus === 'in_progress') {
      if (attempts >= maxAttempts) {
        throw new Error('Assistant run timeout');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      
      if (!statusResponse.ok) {
        throw new Error(`Failed to check run status: ${statusResponse.status}`);
      }
      
      const statusData = await statusResponse.json();
      runStatus = statusData.status;
      attempts++;
    }

    if (runStatus !== 'completed') {
      throw new Error(`Assistant run failed with status: ${runStatus}`);
    }

    // Get the assistant's response
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!messagesResponse.ok) {
      throw new Error(`Failed to get messages: ${messagesResponse.status}`);
    }

    const messages = await messagesResponse.json();
    const assistantMessage = messages.data.find((msg: any) => msg.role === 'assistant');
    
    if (!assistantMessage || !assistantMessage.content[0]?.text?.value) {
      throw new Error('No response from assistant');
    }

    const content = assistantMessage.content[0].text.value;
    
    // Parse the JSON response
    const quizData = JSON.parse(content);
    
    // Convert to our Question format
    const questions: Question[] = quizData.questions.map((q: any, index: number) => ({
      id: `q_${Date.now()}_${index}`,
      question: q.question,
      options: q.options,
      correctAnswer: q.correct_answer_index,
      explanation: q.explanation
    }));

    console.log(`✅ Generated ${questions.length} questions for topic: ${topic}`);
    return questions;

  } catch (error) {
    console.error("❌ Error generating quiz:", error);
    throw error;
  }
}

export default class QuizWorldServer implements Party.Server {
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
        questionTimeLimit: 30,
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
    this.session.questionStartTime = new Date();
    
    // Reset all players
    Object.values(this.session.players).forEach(player => {
      player.hasAnswered = false;
      player.score = 0;
    });
    
    console.log(`🚀 Quiz started in room ${this.roomId} with ${playerCount} player(s)`);
    
    this.broadcastSessionUpdate();
    this.startQuestionTimer();
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

    // Calculate score if correct
    const currentQuestion = this.session.quiz.questions[this.session.currentQuestionIndex];
    if (answerIndex === currentQuestion.correctAnswer) {
      // Score based on time (faster = more points)
      const timeElapsed = Date.now() - (this.session.questionStartTime?.getTime() || 0);
      const timeBonus = Math.max(0, this.session.questionTimeLimit * 1000 - timeElapsed);
      const points = Math.round(100 + (timeBonus / 100));
      player.score += points;
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
    } else {
      // Next question
      this.session.gameState = 'playing';
      this.session.questionStartTime = new Date();
      
      // Reset player answers
      Object.values(this.session.players).forEach(player => {
        player.hasAnswered = false;
        player.currentAnswer = undefined;
      });
      
      this.startQuestionTimer();
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
        questionTimeLimit: 30,
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

  private startQuestionTimer() {
    if (!this.session) return;
    
    setTimeout(() => {
      if (this.session && this.session.gameState === 'playing') {
        this.showQuestionResults();
      }
    }, this.session.questionTimeLimit * 1000);
  }

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
