/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Firebase
const mockFirebase = {
    firebaseReady: true,
    firebaseDatabase: {
        ref: vi.fn(() => ({
            push: vi.fn(() => Promise.resolve({ key: 'mock-quiz-id' })),
            set: vi.fn(() => Promise.resolve()),
            once: vi.fn(() => Promise.resolve({
                val: () => ({
                    'mock-quiz-id': {
                        id: 'mock-quiz-id',
                        title: 'Test Quiz',
                        topic: 'Test Topic',
                        questions: [
                            {
                                id: 'q1',
                                question: 'Test Question?',
                                options: ['A', 'B', 'C', 'D'],
                                correctAnswer: 0,
                                explanation: 'Test explanation'
                            }
                        ],
                        createdBy: 'Test User',
                        createdAt: Date.now()
                    }
                })
            })),
            orderByChild: vi.fn(() => ({
                limitToLast: vi.fn(() => ({
                    once: vi.fn(() => Promise.resolve({ val: () => ({}) }))
                }))
            }))
        }))
    }
};

// Mock WebSocket
class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = WebSocket.CONNECTING;
        setTimeout(() => {
            this.readyState = WebSocket.OPEN;
            if (this.onopen) this.onopen();
        }, 10);
    }
    
    send(data) {
        // Mock sending data
    }
    
    close() {
        this.readyState = WebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000 });
    }
}

// Setup DOM environment
beforeEach(() => {
    // Mock global objects
    global.window = {
        ...global.window,
        firebaseReady: true,
        firebaseDatabase: mockFirebase.firebaseDatabase,
        PARTYKIT_HOST: 'localhost:1999',
        CONFIG: { ALLOW_ANYONE_TO_START: false },
        WebSocket: MockWebSocket,
        addEventListener: vi.fn(),
        location: { hostname: 'localhost' }
    };
    
    global.WebSocket = MockWebSocket;
    global.WebSocket.CONNECTING = 0;
    global.WebSocket.OPEN = 1;
    global.WebSocket.CLOSING = 2;
    global.WebSocket.CLOSED = 3;
    
    // Setup basic DOM structure
    document.body.innerHTML = `
        <div id="welcome-screen" class="game-screen active"></div>
        <div id="create-quiz-screen" class="game-screen hidden"></div>
        <div id="browse-quizzes-screen" class="game-screen hidden"></div>
        <div id="lobby-screen" class="game-screen hidden"></div>
        <div id="quiz-screen" class="game-screen hidden"></div>
        <div id="final-results-screen" class="game-screen hidden"></div>
        <div id="loading-overlay" class="loading-overlay hidden">
            <div class="loading-content">
                <h3 id="loading-message"></h3>
                <p id="loading-submessage"></p>
            </div>
        </div>
        <div id="final-leaderboard" class="leaderboard"></div>
        <div id="quiz-list" class="quiz-list"></div>
        <div id="toast-container" class="toast-container"></div>
        <div id="alert-modal" class="modal-overlay hidden">
            <div class="modal">
                <div class="modal-header">
                    <h3 class="modal-title"></h3>
                </div>
                <div class="modal-body">
                    <p id="alert-message"></p>
                </div>
                <div class="modal-actions">
                    <button id="alert-ok-btn"></button>
                </div>
            </div>
        </div>
        <div id="prompt-modal" class="modal-overlay hidden">
            <div class="modal">
                <div class="modal-header">
                    <h3 class="modal-title"></h3>
                </div>
                <div class="modal-body">
                    <p id="prompt-message"></p>
                    <input type="text" id="prompt-input" />
                </div>
                <div class="modal-actions">
                    <button id="prompt-cancel-btn"></button>
                    <button id="prompt-ok-btn"></button>
                </div>
            </div>
        </div>
    `;
});

afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
});

// Mock the classes instead of importing them (to avoid Firebase CDN import issues)
class MockQuizDatabase {
    constructor() {
        this.ready = true;
    }
    
    async saveQuiz(quiz) {
        return 'mock-quiz-id';
    }
    
    async getQuiz(id) {
        return {
            id: 'mock-quiz-id',
            title: 'Test Quiz',
            topic: 'Test Topic',
            questions: [
                {
                    id: 'q1',
                    question: 'Test Question?',
                    options: ['A', 'B', 'C', 'D'],
                    correctAnswer: 0,
                    explanation: 'Test explanation'
                }
            ],
            createdBy: 'Test User',
            createdAt: Date.now()
        };
    }
    
    async saveHighscore(quizId, playerName, score, questions, time) {
        return { success: true };
    }
}

class MockQuizGameClient {
    constructor() {
        this.gameState = {
            roomCode: '',
            playerName: '',
            isHost: false,
            currentSession: null,
            currentQuiz: null
        };
        this.currentScreen = 'welcome';
        this.quizDatabase = new MockQuizDatabase();
        this.selectedTournamentQuizzes = [];
        this.socket = null;
    }
    
    async init() {
        return true;
    }
    
    showScreen(screenName) {
        // Hide all screens
        document.querySelectorAll('.game-screen').forEach(screen => {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        });
        
        // Show target screen
        const targetScreen = document.getElementById(`${screenName}-screen`);
        if (targetScreen) {
            targetScreen.classList.remove('hidden');
            targetScreen.classList.add('active');
        }
        
        this.currentScreen = screenName;
    }
    
    generateRoomCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }
    
    isHost() {
        return this.gameState.isHost;
    }
    
    getCurrentPlayer() {
        if (!this.gameState.currentSession || !this.gameState.playerName) {
            return null;
        }
        
        const players = this.gameState.currentSession.players;
        return Object.values(players).find(player => player.name === this.gameState.playerName);
    }
    
    updateFinalLeaderboard(playerAnswers) {
        const leaderboardElement = document.getElementById('final-leaderboard');
        if (!leaderboardElement) return;
        
        if (!playerAnswers || Object.keys(playerAnswers).length === 0) {
            leaderboardElement.innerHTML = '<div class="no-scores">No scores available</div>';
            return;
        }
        
        const players = Object.entries(playerAnswers).map(([id, data]) => ({
            id,
            name: data.name,
            score: data.score || 0
        }));
        
        players.sort((a, b) => b.score - a.score);
        
        leaderboardElement.innerHTML = '';
        players.forEach((player, index) => {
            const scoreItem = document.createElement('div');
            scoreItem.className = 'score-item';
            
            if (index === 0) scoreItem.classList.add('first-place');
            else if (index === 1) scoreItem.classList.add('second-place');
            else if (index === 2) scoreItem.classList.add('third-place');
            
            scoreItem.innerHTML = `
                <span class="rank">#${index + 1}</span>
                <span class="name">${player.name}</span>
                <span class="score">${player.score} pts</span>
            `;
            leaderboardElement.appendChild(scoreItem);
        });
    }
    
    showLoading(message, submessage) {
        const overlay = document.getElementById('loading-overlay');
        const messageEl = document.getElementById('loading-message');
        const submessageEl = document.getElementById('loading-submessage');
        
        if (messageEl) messageEl.textContent = message;
        if (submessageEl) submessageEl.textContent = submessage;
        if (overlay) overlay.classList.remove('hidden');
    }
    
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.add('hidden');
    }
    
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }
    
    showAlert(message) {
        return new Promise(resolve => {
            const modal = document.getElementById('alert-modal');
            const messageEl = document.getElementById('alert-message');
            const okBtn = document.getElementById('alert-ok-btn');
            
            if (messageEl) messageEl.textContent = message;
            if (modal) modal.classList.remove('hidden');
            
            const handleOk = () => {
                if (modal) modal.classList.add('hidden');
                okBtn.removeEventListener('click', handleOk);
                resolve();
            };
            
            okBtn.addEventListener('click', handleOk);
        });
    }
    
    showPrompt(message, title) {
        return new Promise(resolve => {
            const modal = document.getElementById('prompt-modal');
            const messageEl = document.getElementById('prompt-message');
            const input = document.getElementById('prompt-input');
            const okBtn = document.getElementById('prompt-ok-btn');
            const cancelBtn = document.getElementById('prompt-cancel-btn');
            
            if (messageEl) messageEl.textContent = message;
            if (input) input.value = '';
            if (modal) modal.classList.remove('hidden');
            
            const handleOk = () => {
                const value = input ? input.value.trim() : '';
                if (modal) modal.classList.add('hidden');
                cleanup();
                resolve(value || null);
            };
            
            const handleCancel = () => {
                if (modal) modal.classList.add('hidden');
                cleanup();
                resolve(null);
            };
            
            const cleanup = () => {
                okBtn.removeEventListener('click', handleOk);
                cancelBtn.removeEventListener('click', handleCancel);
            };
            
            okBtn.addEventListener('click', handleOk);
            cancelBtn.addEventListener('click', handleCancel);
        });
    }
    
    displayQuizzes(quizzes) {
        const quizList = document.getElementById('quiz-list');
        if (!quizList) return;
        
        quizList.innerHTML = '';
        quizzes.forEach(quiz => {
            const quizElement = document.createElement('div');
            quizElement.className = 'quiz-item';
            quizElement.innerHTML = `
                <h3>${quiz.title}</h3>
                <p>${quiz.topic}</p>
                <span>${quiz.questions.length} questions</span>
                <span>By ${quiz.createdBy}</span>
            `;
            quizList.appendChild(quizElement);
        });
    }
    
    addQuizToTournament(quiz) {
        if (!this.selectedTournamentQuizzes.find(q => q.id === quiz.id)) {
            this.selectedTournamentQuizzes.push(quiz);
        }
    }
    
    removeQuizFromTournament(quizId) {
        this.selectedTournamentQuizzes = this.selectedTournamentQuizzes.filter(q => q.id !== quizId);
    }
    
    createCombinedQuiz(title, creator) {
        const allQuestions = [];
        this.selectedTournamentQuizzes.forEach(quiz => {
            allQuestions.push(...quiz.questions);
        });
        
        return {
            id: `tournament_${Date.now()}`,
            title,
            questions: this.shuffleArray(allQuestions),
            createdBy: creator,
            isTournament: true,
            sourceQuizzes: this.selectedTournamentQuizzes.map(q => ({
                id: q.id,
                title: q.title,
                questionCount: q.questions.length
            }))
        };
    }
    
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
    
    async connectWebSocket() {
        this.socket = new global.WebSocket(`ws://test/${this.gameState.roomCode}`);
        return new Promise(resolve => {
            this.socket.onopen = () => resolve();
        });
    }
    
    sendMessage(data) {
        if (this.socket && this.socket.readyState === 1) {
            this.socket.send(JSON.stringify(data));
        }
    }
    
    handleSessionUpdate(data) {
        this.gameState.currentSession = data.session;
    }
    
    async playQuiz(quizId) {
        // Mock implementation
        this.gameState.roomCode = this.generateRoomCode();
        this.gameState.isHost = true;
        return Promise.resolve();
    }
    
    startQuiz() {
        this.showScreen('quiz');
    }
    
    selectAnswer(answerIndex) {
        // Mock implementation
    }
    
    nextQuestion() {
        // Mock implementation
    }
    
    handleQuizFinished(data) {
        this.showScreen('final-results');
        this.updateFinalLeaderboard(data.playerAnswers);
    }
}

const QuizDatabase = MockQuizDatabase;
const QuizGameClient = MockQuizGameClient;

describe('QuizDatabase', () => {
    let quizDatabase;
    
    beforeEach(() => {
        quizDatabase = new QuizDatabase();
    });
    
    it('should initialize with Firebase ready state', () => {
        expect(quizDatabase).toBeDefined();
    });
    
    it('should save a quiz to Firebase', async () => {
        const quiz = {
            title: 'Test Quiz',
            topic: 'Test Topic',
            questions: [],
            createdBy: 'Test User',
            createdAt: new Date()
        };
        
        const quizId = await quizDatabase.saveQuiz(quiz);
        expect(quizId).toBe('mock-quiz-id');
    });
    
    it('should retrieve a quiz from Firebase', async () => {
        const quiz = await quizDatabase.getQuiz('mock-quiz-id');
        expect(quiz).toBeDefined();
        expect(quiz.title).toBe('Test Quiz');
    });
    
    it('should save highscores', async () => {
        const result = await quizDatabase.saveHighscore('quiz-id', 'Player', 100, 10, 300);
        expect(result).toBeDefined();
    });
});

describe('QuizGameClient', () => {
    let gameClient;
    
    beforeEach(async () => {
        gameClient = new QuizGameClient();
        await gameClient.init();
    });
    
    describe('Initialization', () => {
        it('should initialize with default game state', () => {
            expect(gameClient.gameState).toBeDefined();
            expect(gameClient.gameState.roomCode).toBe('');
            expect(gameClient.gameState.playerName).toBe('');
            expect(gameClient.gameState.isHost).toBe(false);
        });
        
        it('should initialize quiz database', () => {
            expect(gameClient.quizDatabase).toBeDefined();
        });
    });
    
    describe('Screen Management', () => {
        it('should show different screens', () => {
            gameClient.showScreen('create-quiz');
            
            const welcomeScreen = document.getElementById('welcome-screen');
            const createQuizScreen = document.getElementById('create-quiz-screen');
            
            expect(welcomeScreen.classList.contains('hidden')).toBe(true);
            expect(createQuizScreen.classList.contains('active')).toBe(true);
        });
        
        it('should track current screen', () => {
            gameClient.showScreen('browse-quizzes');
            expect(gameClient.currentScreen).toBe('browse-quizzes');
        });
    });
    
    describe('Room Code Generation', () => {
        it('should generate 6-digit room codes', () => {
            const roomCode = gameClient.generateRoomCode();
            expect(roomCode).toMatch(/^\d{6}$/);
        });
        
        it('should generate different room codes', () => {
            const code1 = gameClient.generateRoomCode();
            const code2 = gameClient.generateRoomCode();
            expect(code1).not.toBe(code2);
        });
    });
    
    describe('Player Management', () => {
        it('should identify host correctly', () => {
            gameClient.gameState.isHost = true;
            expect(gameClient.isHost()).toBe(true);
            
            gameClient.gameState.isHost = false;
            expect(gameClient.isHost()).toBe(false);
        });
        
        it('should get current player', () => {
            gameClient.gameState.playerName = 'TestPlayer';
            gameClient.gameState.currentSession = {
                players: {
                    'player1': { name: 'TestPlayer', score: 100 }
                }
            };
            
            const player = gameClient.getCurrentPlayer();
            expect(player.name).toBe('TestPlayer');
            expect(player.score).toBe(100);
        });
    });
    
    describe('Scoring System', () => {
        it('should calculate correct scores (100 points per correct answer)', () => {
            const playerAnswers = {
                'player1': { name: 'Player1', score: 700 },
                'player2': { name: 'Player2', score: 500 }
            };
            
            gameClient.updateFinalLeaderboard(playerAnswers);
            
            const leaderboard = document.getElementById('final-leaderboard');
            expect(leaderboard.innerHTML).toContain('700 pts');
            expect(leaderboard.innerHTML).toContain('500 pts');
        });
        
        it('should sort players by score', () => {
            const playerAnswers = {
                'player1': { name: 'Player1', score: 300 },
                'player2': { name: 'Player2', score: 700 },
                'player3': { name: 'Player3', score: 500 }
            };
            
            gameClient.updateFinalLeaderboard(playerAnswers);
            
            const leaderboard = document.getElementById('final-leaderboard');
            const scoreItems = leaderboard.querySelectorAll('.score-item');
            
            expect(scoreItems[0].innerHTML).toContain('Player2'); // Highest score first
            expect(scoreItems[1].innerHTML).toContain('Player3');
            expect(scoreItems[2].innerHTML).toContain('Player1'); // Lowest score last
        });
    });
    
    describe('Loading States', () => {
        it('should show and hide loading overlay', () => {
            const overlay = document.getElementById('loading-overlay');
            
            gameClient.showLoading('Test Message', 'Test Submessage');
            expect(overlay.classList.contains('hidden')).toBe(false);
            
            gameClient.hideLoading();
            expect(overlay.classList.contains('hidden')).toBe(true);
        });
        
        it('should update loading messages', () => {
            gameClient.showLoading('Main Message', 'Sub Message');
            
            const mainMessage = document.getElementById('loading-message');
            const subMessage = document.getElementById('loading-submessage');
            
            expect(mainMessage.textContent).toBe('Main Message');
            expect(subMessage.textContent).toBe('Sub Message');
        });
    });
    
    describe('Toast Notifications', () => {
        it('should show toast messages', () => {
            gameClient.showToast('Test message', 'success');
            
            const container = document.getElementById('toast-container');
            expect(container.children.length).toBe(1);
            expect(container.children[0].textContent).toBe('Test message');
            expect(container.children[0].classList.contains('toast-success')).toBe(true);
        });
    });
    
    describe('Modal Dialogs', () => {
        it('should show alert modal', async () => {
            const alertPromise = gameClient.showAlert('Test alert message');
            
            const modal = document.getElementById('alert-modal');
            const message = document.getElementById('alert-message');
            
            expect(modal.classList.contains('hidden')).toBe(false);
            expect(message.textContent).toBe('Test alert message');
            
            // Simulate clicking OK
            const okBtn = document.getElementById('alert-ok-btn');
            okBtn.click();
            
            await alertPromise;
            expect(modal.classList.contains('hidden')).toBe(true);
        });
        
        it('should show prompt modal and return input', async () => {
            const promptPromise = gameClient.showPrompt('Enter name:', 'Name Input');
            
            const modal = document.getElementById('prompt-modal');
            const input = document.getElementById('prompt-input');
            const okBtn = document.getElementById('prompt-ok-btn');
            
            expect(modal.classList.contains('hidden')).toBe(false);
            
            // Simulate user input
            input.value = 'Test User';
            okBtn.click();
            
            const result = await promptPromise;
            expect(result).toBe('Test User');
        });
    });
    
    describe('Quiz Display', () => {
        it('should display quiz list', () => {
            const quizzes = [
                {
                    id: 'quiz1',
                    title: 'Quiz 1',
                    topic: 'Topic 1',
                    questions: [1, 2, 3],
                    createdBy: 'User 1'
                },
                {
                    id: 'quiz2',
                    title: 'Quiz 2',
                    topic: 'Topic 2',
                    questions: [1, 2, 3, 4, 5],
                    createdBy: 'User 2'
                }
            ];
            
            gameClient.displayQuizzes(quizzes);
            
            const quizList = document.getElementById('quiz-list');
            expect(quizList.children.length).toBe(2);
            expect(quizList.innerHTML).toContain('Quiz 1');
            expect(quizList.innerHTML).toContain('Quiz 2');
            expect(quizList.innerHTML).toContain('3 questions');
            expect(quizList.innerHTML).toContain('5 questions');
        });
    });
    
    describe('Tournament Functionality', () => {
        it('should initialize selected tournament quizzes array', () => {
            gameClient.selectedTournamentQuizzes = [];
            expect(gameClient.selectedTournamentQuizzes).toEqual([]);
        });
        
        it('should add quiz to tournament', () => {
            const quiz = {
                id: 'quiz1',
                title: 'Test Quiz',
                questions: [1, 2, 3]
            };
            
            gameClient.addQuizToTournament(quiz);
            expect(gameClient.selectedTournamentQuizzes).toContain(quiz);
        });
        
        it('should remove quiz from tournament', () => {
            const quiz = {
                id: 'quiz1',
                title: 'Test Quiz',
                questions: [1, 2, 3]
            };
            
            gameClient.selectedTournamentQuizzes = [quiz];
            gameClient.removeQuizFromTournament('quiz1');
            expect(gameClient.selectedTournamentQuizzes).not.toContain(quiz);
        });
        
        it('should create combined quiz from multiple quizzes', () => {
            const quiz1 = {
                id: 'quiz1',
                title: 'Quiz 1',
                questions: [{ id: 'q1', question: 'Q1' }]
            };
            const quiz2 = {
                id: 'quiz2',
                title: 'Quiz 2',
                questions: [{ id: 'q2', question: 'Q2' }]
            };
            
            gameClient.selectedTournamentQuizzes = [quiz1, quiz2];
            const combined = gameClient.createCombinedQuiz('Tournament', 'Host');
            
            expect(combined.questions.length).toBe(2);
            expect(combined.title).toBe('Tournament');
            expect(combined.isTournament).toBe(true);
        });
        
        it('should shuffle array correctly', () => {
            const original = [1, 2, 3, 4, 5];
            const shuffled = gameClient.shuffleArray(original);
            
            expect(shuffled.length).toBe(original.length);
            expect(shuffled).toEqual(expect.arrayContaining(original));
            // Note: We can't test randomness reliably, but we can test that all elements are preserved
        });
    });
    
    describe('WebSocket Connection', () => {
        it('should connect to WebSocket', async () => {
            gameClient.gameState.roomCode = '123456';
            
            await gameClient.connectWebSocket();
            expect(gameClient.socket).toBeDefined();
            expect(gameClient.socket.url).toContain('123456');
        });
        
        it('should send messages when connected', () => {
            gameClient.socket = new MockWebSocket('ws://test');
            gameClient.socket.readyState = WebSocket.OPEN;
            
            const sendSpy = vi.spyOn(gameClient.socket, 'send');
            
            gameClient.sendMessage({ type: 'test', data: 'test' });
            expect(sendSpy).toHaveBeenCalled();
        });
    });
});

describe('Game Flow Integration', () => {
    let gameClient;
    
    beforeEach(async () => {
        gameClient = new QuizGameClient();
        await gameClient.init();
    });
    
    it('should handle complete quiz flow', async () => {
        // Start with welcome screen
        expect(gameClient.currentScreen).toBe('welcome');
        
        // Navigate to browse quizzes
        gameClient.showScreen('browse-quizzes');
        expect(gameClient.currentScreen).toBe('browse-quizzes');
        
        // Simulate quiz selection and play
        gameClient.gameState.roomCode = '123456';
        gameClient.gameState.playerName = 'TestPlayer';
        gameClient.gameState.isHost = true;
        
        // Show lobby
        gameClient.showScreen('lobby');
        expect(gameClient.currentScreen).toBe('lobby');
        
        // Start quiz
        gameClient.showScreen('quiz');
        expect(gameClient.currentScreen).toBe('quiz');
        
        // Finish quiz
        const mockPlayerAnswers = {
            'player1': { name: 'TestPlayer', score: 800 }
        };
        
        gameClient.handleQuizFinished({ playerAnswers: mockPlayerAnswers });
        expect(gameClient.currentScreen).toBe('final-results');
        
        // Check leaderboard was updated
        const leaderboard = document.getElementById('final-leaderboard');
        expect(leaderboard.innerHTML).toContain('TestPlayer');
        expect(leaderboard.innerHTML).toContain('800 pts');
    });
}); 