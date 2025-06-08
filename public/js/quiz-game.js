// Import Firebase functions
import { ref, push, set, get, query, orderByChild, limitToLast, update } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// Firebase Database Service
class QuizDatabase {
    constructor() {
        this.db = window.firebaseDatabase;
        this.isReady = window.firebaseReady || false;
    }

    async waitForFirebase() {
        if (this.isReady && this.db) {
            return true;
        }
        
        // Wait up to 5 seconds for Firebase to initialize
        for (let i = 0; i < 50; i++) {
            if (window.firebaseReady && window.firebaseDatabase) {
                this.db = window.firebaseDatabase;
                this.isReady = true;
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.warn('⚠️ Firebase not ready, some features may not work');
        return false;
    }

    async saveQuiz(quiz) {
        if (!await this.waitForFirebase()) {
            throw new Error('Firebase not available');
        }
        
        try {
            const quizzesRef = ref(this.db, 'quizzes');
            const newQuizRef = push(quizzesRef);
            const quizId = newQuizRef.key;
            
            const quizData = {
                id: quizId,
                topic: quiz.topic,
                questions: quiz.questions,
                createdBy: quiz.createdBy,
                createdAt: Date.now(),
                playCount: 0,
                averageScore: 0
            };
            
            await set(newQuizRef, quizData);
            return quizId;
        } catch (error) {
            console.error('Error saving quiz:', error);
            throw error;
        }
    }

    async getQuiz(quizId) {
        try {
            const quizRef = ref(this.db, `quizzes/${quizId}`);
            const snapshot = await get(quizRef);
            
            if (snapshot.exists()) {
                return snapshot.val();
            } else {
                throw new Error('Quiz not found');
            }
        } catch (error) {
            console.error('Error getting quiz:', error);
            throw error;
        }
    }

    async saveHighscore(quizId, playerName, score, totalQuestions, timeSpent) {
        try {
            const highscoresRef = ref(this.db, `highscores/${quizId}`);
            const newScoreRef = push(highscoresRef);
            
            const scoreData = {
                playerName: playerName,
                score: score,
                totalQuestions: totalQuestions,
                percentage: Math.round((score / totalQuestions) * 100),
                timeSpent: timeSpent,
                timestamp: Date.now()
            };
            
            await set(newScoreRef, scoreData);
            await this.updateQuizStats(quizId, score, totalQuestions);
            
            return newScoreRef.key;
        } catch (error) {
            console.error('Error saving highscore:', error);
            throw error;
        }
    }

    async getHighscores(quizId, limit = 10) {
        try {
            const highscoresRef = ref(this.db, `highscores/${quizId}`);
            const snapshot = await get(highscoresRef);
            
            if (snapshot.exists()) {
                const scores = [];
                snapshot.forEach((childSnapshot) => {
                    scores.push(childSnapshot.val());
                });
                return scores.sort((a, b) => {
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }
                    return a.timeSpent - b.timeSpent;
                }).slice(0, limit);
            } else {
                return [];
            }
        } catch (error) {
            console.error('Error getting highscores:', error);
            throw error;
        }
    }

    async updateQuizStats(quizId, score, totalQuestions) {
        try {
            const quizRef = ref(this.db, `quizzes/${quizId}`);
            const snapshot = await get(quizRef);
            
            if (snapshot.exists()) {
                const quiz = snapshot.val();
                const currentPlayCount = quiz.playCount || 0;
                const currentAverage = quiz.averageScore || 0;
                
                const newPlayCount = currentPlayCount + 1;
                const percentage = (score / totalQuestions) * 100;
                const newAverage = ((currentAverage * currentPlayCount) + percentage) / newPlayCount;
                
                await update(quizRef, {
                    playCount: newPlayCount,
                    averageScore: Math.round(newAverage * 100) / 100
                });
            }
        } catch (error) {
            console.error('Error updating quiz stats:', error);
        }
    }

    async getAllQuizzes() {
        if (!await this.waitForFirebase()) {
            console.warn('Firebase not available, returning empty quiz list');
            return [];
        }
        
        try {
            const quizzesRef = ref(this.db, 'quizzes');
            const snapshot = await get(quizzesRef);
            
            if (snapshot.exists()) {
                const quizzes = [];
                snapshot.forEach((childSnapshot) => {
                    quizzes.push(childSnapshot.val());
                });
                return quizzes.sort((a, b) => b.createdAt - a.createdAt);
            } else {
                return [];
            }
        } catch (error) {
            console.error('Error getting all quizzes:', error);
            return [];
        }
    }

    async searchQuizzes(searchTerm) {
        try {
            const quizzes = await this.getAllQuizzes();
            return quizzes.filter(quiz => 
                quiz.topic.toLowerCase().includes(searchTerm.toLowerCase())
            );
        } catch (error) {
            console.error('Error searching quizzes:', error);
            throw error;
        }
    }

    async getPopularQuizzes(limit = 10) {
        try {
            const quizzes = await this.getAllQuizzes();
            return quizzes
                .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
                .slice(0, limit);
        } catch (error) {
            console.error('Error getting popular quizzes:', error);
            throw error;
        }
    }
}

// QuizWorld Game Client
class QuizGameClient {
    constructor() {
        this.socket = null;
        this.gameState = {
            roomCode: '',
            playerName: '',
            isHost: false,
            players: {},
            currentQuiz: null,
            currentSession: null,
            currentQuestionIndex: -1,
            timeRemaining: 30
        };
        this.currentScreen = 'welcome';
        this.timer = null;
        this.quizDatabase = new QuizDatabase();
        this.gameStartTime = null;
        
        this.init();
    }

    async init() {
        console.log('🎮 Initializing QuizWorld...');
        
        // Wait for Firebase to be ready
        await this.quizDatabase.waitForFirebase();
        
        this.setupEventListeners();
        this.showScreen('welcome');
        
        // Check for room code in URL
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        if (roomCode) {
            this.showJoinInterface(roomCode);
        }
        
        console.log('✅ QuizWorld initialized successfully');
    }

    setupEventListeners() {
        // Welcome screen
        document.getElementById('create-quiz-option').onclick = () => this.showScreen('create-quiz');
        document.getElementById('browse-quizzes-option').onclick = () => this.showBrowseQuizzes();
        document.getElementById('join-quiz-option').onclick = () => this.showScreen('join-session');
        
        // Create quiz screen
        document.getElementById('create-quiz-form').onsubmit = (e) => this.handleCreateQuiz(e);
        document.getElementById('back-to-welcome').onclick = () => this.showScreen('welcome');
        
        // Browse quizzes screen
        document.getElementById('back-to-welcome-3').onclick = () => this.showScreen('welcome');
        document.getElementById('search-btn').onclick = () => this.searchQuizzes();
        document.getElementById('quiz-search').onkeypress = (e) => {
            if (e.key === 'Enter') this.searchQuizzes();
        };
        
        // Filter tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => this.filterQuizzes(btn.dataset.filter);
        });
        
        // Join session screen
        document.getElementById('join-session-form').onsubmit = (e) => this.handleJoinSession(e);
        document.getElementById('back-to-welcome-2').onclick = () => this.showScreen('welcome');
        
        // Lobby screen
        document.getElementById('ready-btn').onclick = () => this.toggleReady();
        document.getElementById('start-quiz-btn').onclick = () => this.startQuiz();
        document.getElementById('copy-room-code').onclick = () => this.copyRoomCode();
        
        // Quiz screen - answer selection will be handled dynamically
        
        // Results screen
        document.getElementById('next-question-btn').onclick = () => this.nextQuestion();
        document.getElementById('view-final-results-btn').onclick = () => this.showScreen('final-results');
        
        // Final results screen
        document.getElementById('play-again-btn').onclick = () => this.playAgain();
        document.getElementById('new-quiz-btn').onclick = () => this.showScreen('welcome');
    }

    showScreen(screenName) {
        // Hide all screens
        document.querySelectorAll('.game-screen').forEach(screen => {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        });
        
        // Show target screen
        const targetScreen = document.getElementById(screenName + '-screen');
        if (targetScreen) {
            targetScreen.classList.add('active');
            targetScreen.classList.remove('hidden');
            this.currentScreen = screenName;
            console.log(`Switched to ${screenName} screen`);
        }
    }

    showJoinInterface(roomCode) {
        this.gameState.roomCode = roomCode;
        document.getElementById('room-code').value = roomCode;
        this.showScreen('join-session');
        
        // Focus on name input
        setTimeout(() => {
            document.getElementById('player-name').focus();
        }, 100);
    }

    async handleCreateQuiz(event) {
        event.preventDefault();
        
        const title = document.getElementById('quiz-title').value.trim();
        const topic = document.getElementById('quiz-topic').value.trim();
        const questionCount = parseInt(document.getElementById('question-count').value);
        const creatorName = document.getElementById('creator-name').value.trim();
        
        if (!title || !topic || !creatorName) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }
        
        // Show loading
        this.showLoading('Generating your quiz...', 'AI is creating questions based on your topic');
        
        // Generate room code and connect
        this.gameState.roomCode = this.generateRoomCode();
        this.gameState.playerName = creatorName;
        this.gameState.isHost = true;
        
        try {
            await this.connectWebSocket();
            
            // Send create quiz message
            this.sendMessage({
                type: 'create_quiz',
                title,
                topic,
                questionCount,
                playerName: creatorName
            });
        } catch (error) {
            this.hideLoading();
            this.showToast('Failed to create quiz. Please try again.', 'error');
            console.error('Error creating quiz:', error);
        }
    }

    async handleJoinSession(event) {
        event.preventDefault();
        
        const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
        const playerName = document.getElementById('player-name').value.trim();
        
        if (!roomCode || !playerName) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }
        
        if (roomCode.length !== 6) {
            this.showToast('Room code must be 6 characters', 'error');
            return;
        }
        
        this.gameState.roomCode = roomCode;
        this.gameState.playerName = playerName;
        this.gameState.isHost = false;
        
        try {
            await this.connectWebSocket();
            
            // Send join session message
            this.sendMessage({
                type: 'join_session',
                playerName
            });
        } catch (error) {
            this.showToast('Failed to join session. Please check the room code.', 'error');
            console.error('Error joining session:', error);
        }
    }

    connectWebSocket() {
        return new Promise((resolve, reject) => {
            // Use PartyKit host for WebSocket connection
            const protocol = window.PARTYKIT_HOST.includes('localhost') ? 'ws:' : 'wss:';
            const host = window.PARTYKIT_HOST;
            const url = `${protocol}//${host}/party/${this.gameState.roomCode}`;
            
            console.log('Connecting to:', url);
            
            if (this.socket) {
                this.socket.close();
            }
            
            this.socket = new WebSocket(url);
            
            this.socket.onopen = () => {
                console.log('WebSocket connected to room:', this.gameState.roomCode);
                resolve();
            };
            
            this.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            this.socket.onclose = (event) => {
                console.log('WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
                this.showToast('Connection lost', 'error');
            };
            
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };
        });
    }

    sendMessage(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(data));
            console.log('Sent:', data);
        } else {
            console.error('Cannot send message: WebSocket not connected');
        }
    }

    handleMessage(data) {
        console.log('Received:', data);
        
        switch (data.type) {
            case 'quiz_created':
                this.handleQuizCreated(data);
                break;
            case 'session_update':
                this.handleSessionUpdate(data);
                break;
            case 'session_state':
                this.handleSessionState(data);
                break;
            case 'question_results':
                this.handleQuestionResults(data);
                break;
            case 'error':
                this.hideLoading();
                this.showToast(data.message || 'Server error', 'error');
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    async handleQuizCreated(data) {
        this.hideLoading();
        this.gameState.currentQuiz = data.quiz;
        this.gameState.currentSession = {
            id: data.sessionId,
            quiz: data.quiz,
            players: {},
            gameState: 'waiting',
            host: this.socket.id || 'host'
        };
        
        // Save quiz to Firebase
        try {
            const quizId = await this.quizDatabase.saveQuiz(data.quiz);
            console.log('💾 Quiz saved to Firebase with ID:', quizId);
            
            // Update the quiz ID in our session
            if (this.gameState.currentQuiz) {
                this.gameState.currentQuiz.id = quizId;
            }
            if (this.gameState.currentSession && this.gameState.currentSession.quiz) {
                this.gameState.currentSession.quiz.id = quizId;
            }
        } catch (error) {
            console.error('❌ Error saving quiz to Firebase:', error);
            // Continue without Firebase - quiz will still work in memory
        }
        
        this.showToast('Quiz created successfully!', 'success');
        this.updateLobbyDisplay();
        this.showScreen('lobby');
    }

    handleSessionUpdate(data) {
        this.gameState.currentSession = data.session;
        
        if (this.currentScreen === 'lobby') {
            this.updateLobbyDisplay();
        } else if (this.currentScreen === 'quiz') {
            this.updateQuizDisplay();
        }
    }

    handleSessionState(data) {
        this.gameState.currentSession = data.session;
        
        if (data.session.gameState === 'waiting') {
            this.updateLobbyDisplay();
            this.showScreen('lobby');
        } else if (data.session.gameState === 'playing') {
            // Set game start time when quiz begins
            if (!this.gameStartTime) {
                this.gameStartTime = Date.now();
            }
            this.updateQuizDisplay();
            this.showScreen('quiz');
            this.startQuestionTimer();
        }
    }

    handleQuestionResults(data) {
        this.stopTimer();
        
        // Update results display
        document.getElementById('correct-answer-display').textContent = 
            data.currentQuestion.options[data.currentQuestion.correctAnswer];
        document.getElementById('answer-explanation').textContent = 
            data.currentQuestion.explanation || 'No explanation available';
        
        // Update player scores
        const scoresContainer = document.getElementById('player-scores');
        scoresContainer.innerHTML = '';
        
        Object.entries(data.playerAnswers).forEach(([playerId, playerData]) => {
            const scoreItem = document.createElement('div');
            scoreItem.className = 'score-item';
            
            const isCorrect = playerData.answer === data.currentQuestion.correctAnswer;
            scoreItem.innerHTML = `
                <div class="player-name">${playerData.name}</div>
                <div class="player-answer ${isCorrect ? 'correct' : 'incorrect'}">
                    ${playerData.answer !== undefined ? data.currentQuestion.options[playerData.answer] : 'No answer'}
                </div>
                <div class="player-score">${playerData.score} pts</div>
            `;
            
            scoresContainer.appendChild(scoreItem);
        });
        
        // Show appropriate button
        const session = this.gameState.currentSession;
        if (session.currentQuestionIndex >= session.quiz.questions.length - 1) {
            document.getElementById('view-final-results-btn').classList.remove('hidden');
            document.getElementById('next-question-btn').classList.add('hidden');
            
            // Save highscores when quiz is finished
            this.saveHighscores(data.playerAnswers);
        } else {
            document.getElementById('next-question-btn').classList.remove('hidden');
            document.getElementById('view-final-results-btn').classList.add('hidden');
            
            // Only show next button for host
            if (!this.isHost()) {
                document.getElementById('next-question-btn').style.display = 'none';
            }
        }
        
        this.showScreen('results');
    }

    updateLobbyDisplay() {
        const session = this.gameState.currentSession;
        if (!session) return;
        
        // Update quiz info
        document.getElementById('quiz-title-display').textContent = session.quiz.title;
        document.getElementById('room-code-display').textContent = this.gameState.roomCode;
        document.getElementById('quiz-topic-display').textContent = session.quiz.topic;
        document.getElementById('quiz-question-count').textContent = session.quiz.questions.length;
        document.getElementById('quiz-creator').textContent = session.quiz.createdBy;
        
        // Update players list
        const playersList = document.getElementById('player-list');
        const playerCount = document.getElementById('player-count');
        
        playersList.innerHTML = '';
        const players = Object.values(session.players);
        playerCount.textContent = players.length;
        
        players.forEach(player => {
            const li = document.createElement('li');
            li.className = 'player-item';
            
            if (player.isHost) li.classList.add('host');
            if (player.isReady) li.classList.add('ready');
            
            li.innerHTML = `
                <div class="player-name">${player.name}</div>
                <div class="player-badges">
                    ${player.isHost ? '<span class="badge host">Host</span>' : ''}
                    ${player.isReady ? '<span class="badge ready">Ready</span>' : ''}
                </div>
            `;
            
            playersList.appendChild(li);
        });
        
        // Update host controls
        const hostControls = document.getElementById('host-controls');
        const startBtn = document.getElementById('start-quiz-btn');
        
        if (this.isHost()) {
            hostControls.classList.remove('hidden');
            
            // Enable start button if all players are ready
            const allReady = players.length > 0 && players.every(p => p.isReady);
            startBtn.disabled = !allReady;
        } else {
            hostControls.classList.add('hidden');
        }
    }

    updateQuizDisplay() {
        const session = this.gameState.currentSession;
        if (!session || session.gameState !== 'playing') return;
        
        const currentQuestion = session.quiz.questions[session.currentQuestionIndex];
        if (!currentQuestion) return;
        
        // Update question info
        document.getElementById('current-question-num').textContent = session.currentQuestionIndex + 1;
        document.getElementById('total-questions').textContent = session.quiz.questions.length;
        document.getElementById('question-text').textContent = currentQuestion.question;
        
        // Update answer options
        const optionsContainer = document.getElementById('answer-options');
        optionsContainer.innerHTML = '';
        
        currentQuestion.options.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'answer-option';
            button.textContent = option;
            button.onclick = () => this.selectAnswer(index);
            optionsContainer.appendChild(button);
        });
        
        // Update player status
        const players = Object.values(session.players);
        const answeredCount = players.filter(p => p.hasAnswered).length;
        document.getElementById('players-answered').textContent = answeredCount;
        document.getElementById('total-players-quiz').textContent = players.length;
    }

    selectAnswer(answerIndex) {
        // Disable all options
        document.querySelectorAll('.answer-option').forEach(btn => {
            btn.disabled = true;
            btn.classList.remove('selected');
        });
        
        // Mark selected option
        document.querySelectorAll('.answer-option')[answerIndex].classList.add('selected');
        
        // Send answer to server
        this.sendMessage({
            type: 'submit_answer',
            answerIndex
        });
        
        this.showToast('Answer submitted!', 'success');
    }

    startQuestionTimer() {
        const session = this.gameState.currentSession;
        if (!session) return;
        
        this.gameState.timeRemaining = session.questionTimeLimit;
        this.updateTimerDisplay();
        
        this.timer = setInterval(() => {
            this.gameState.timeRemaining--;
            this.updateTimerDisplay();
            
            if (this.gameState.timeRemaining <= 0) {
                this.stopTimer();
                // Auto-submit if no answer selected
                if (!document.querySelector('.answer-option.selected')) {
                    this.selectAnswer(-1); // No answer
                }
            }
        }, 1000);
    }

    updateTimerDisplay() {
        const timerElement = document.getElementById('time-remaining');
        if (timerElement) {
            timerElement.textContent = this.gameState.timeRemaining;
            
            // Add warning classes
            if (this.gameState.timeRemaining <= 5) {
                timerElement.classList.add('danger');
            } else if (this.gameState.timeRemaining <= 10) {
                timerElement.classList.add('warning');
            }
        }
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    toggleReady() {
        const currentPlayer = this.getCurrentPlayer();
        if (!currentPlayer) return;
        
        const newReadyState = !currentPlayer.isReady;
        
        this.sendMessage({
            type: 'player_ready',
            ready: newReadyState
        });
        
        // Update button
        const btn = document.getElementById('ready-btn');
        btn.textContent = newReadyState ? 'Not Ready' : 'Ready to Play';
        btn.className = newReadyState ? 'btn btn-outline-danger' : 'btn btn-outline-success';
    }

    startQuiz() {
        if (!this.isHost()) {
            this.showToast('Only the host can start the quiz', 'error');
            return;
        }
        
        this.sendMessage({ type: 'start_quiz' });
    }

    nextQuestion() {
        if (!this.isHost()) {
            this.showToast('Only the host can proceed', 'error');
            return;
        }
        
        this.sendMessage({ type: 'next_question' });
    }

    playAgain() {
        // Reset to lobby
        this.showScreen('lobby');
    }

    copyRoomCode() {
        const roomCode = this.gameState.roomCode;
        const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
        
        navigator.clipboard.writeText(url).then(() => {
            this.showToast('Room link copied to clipboard!', 'success');
        }).catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.showToast('Room link copied to clipboard!', 'success');
        });
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    isHost() {
        const session = this.gameState.currentSession;
        if (!session) return false;
        
        const currentPlayer = this.getCurrentPlayer();
        return currentPlayer ? currentPlayer.isHost : false;
    }

    getCurrentPlayer() {
        const session = this.gameState.currentSession;
        if (!session) return null;
        
        return Object.values(session.players).find(p => p.name === this.gameState.playerName);
    }

    async saveHighscores(playerAnswers) {
        if (!this.gameState.currentSession || !this.gameStartTime) return;
        
        try {
            const session = this.gameState.currentSession;
            const totalQuestions = session.quiz.questions.length;
            const gameEndTime = Date.now();
            const totalTimeSpent = Math.round((gameEndTime - this.gameStartTime) / 1000);
            
            // Save highscore for each player
            for (const [playerId, playerData] of Object.entries(playerAnswers)) {
                await this.quizDatabase.saveHighscore(
                    session.quiz.id,
                    playerData.name,
                    playerData.score,
                    totalQuestions,
                    totalTimeSpent
                );
            }
            
            console.log('💾 Highscores saved successfully');
        } catch (error) {
            console.error('❌ Error saving highscores:', error);
        }
    }

    showLoading(message, submessage = '') {
        document.getElementById('loading-message').textContent = message;
        document.getElementById('loading-submessage').textContent = submessage;
        document.getElementById('loading-overlay').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loading-overlay').classList.add('hidden');
    }

    async showBrowseQuizzes() {
        this.showScreen('browse-quizzes');
        this.currentFilter = 'recent';
        await this.loadQuizzes('recent');
    }

    async loadQuizzes(filter = 'recent') {
        const quizList = document.getElementById('quiz-list');
        quizList.innerHTML = '<div class="loading-quizzes"><div class="loading-spinner"></div><p>Loading quizzes...</p></div>';
        
        try {
            let quizzes = [];
            
            if (filter === 'recent') {
                quizzes = await this.quizDatabase.getAllQuizzes();
            } else if (filter === 'popular') {
                quizzes = await this.quizDatabase.getPopularQuizzes();
            } else if (filter === 'all') {
                quizzes = await this.quizDatabase.getAllQuizzes();
            }
            
            this.displayQuizzes(quizzes);
        } catch (error) {
            console.error('Error loading quizzes:', error);
            quizList.innerHTML = '<div class="loading-quizzes"><p>Error loading quizzes. Please try again.</p></div>';
        }
    }

    async searchQuizzes() {
        const searchTerm = document.getElementById('quiz-search').value.trim();
        if (!searchTerm) {
            await this.loadQuizzes(this.currentFilter);
            return;
        }
        
        const quizList = document.getElementById('quiz-list');
        quizList.innerHTML = '<div class="loading-quizzes"><div class="loading-spinner"></div><p>Searching...</p></div>';
        
        try {
            const quizzes = await this.quizDatabase.searchQuizzes(searchTerm);
            this.displayQuizzes(quizzes);
        } catch (error) {
            console.error('Error searching quizzes:', error);
            quizList.innerHTML = '<div class="loading-quizzes"><p>Error searching quizzes. Please try again.</p></div>';
        }
    }

    async filterQuizzes(filter) {
        // Update active tab
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
        
        this.currentFilter = filter;
        await this.loadQuizzes(filter);
    }

    displayQuizzes(quizzes) {
        const quizList = document.getElementById('quiz-list');
        
        if (quizzes.length === 0) {
            quizList.innerHTML = '<div class="loading-quizzes"><p>No quizzes found.</p></div>';
            return;
        }
        
        quizList.innerHTML = '';
        
        quizzes.forEach(quiz => {
            const quizItem = document.createElement('div');
            quizItem.className = 'quiz-item';
            
            const createdDate = new Date(quiz.createdAt).toLocaleDateString();
            
            quizItem.innerHTML = `
                <div class="quiz-item-header">
                    <div>
                        <h4 class="quiz-item-title">${quiz.topic}</h4>
                        <p class="quiz-item-topic">Created by ${quiz.createdBy}</p>
                    </div>
                </div>
                <div class="quiz-item-stats">
                    <div class="quiz-stat">
                        <span>📝</span>
                        <span>${quiz.questions.length} questions</span>
                    </div>
                    <div class="quiz-stat">
                        <span>🎮</span>
                        <span>${quiz.playCount || 0} plays</span>
                    </div>
                    <div class="quiz-stat">
                        <span>📅</span>
                        <span>${createdDate}</span>
                    </div>
                    ${quiz.averageScore ? `
                        <div class="quiz-stat">
                            <span>⭐</span>
                            <span>${quiz.averageScore}% avg</span>
                        </div>
                    ` : ''}
                </div>
                <div class="quiz-item-actions">
                    <button class="btn btn-primary" onclick="window.quizGame.playQuiz('${quiz.id}')">Play Quiz</button>
                    <button class="btn btn-outline" onclick="window.quizGame.viewHighscores('${quiz.id}', '${quiz.topic}')">View Highscores</button>
                </div>
            `;
            
            quizList.appendChild(quizItem);
        });
    }

    async playQuiz(quizId) {
        try {
            const quiz = await this.quizDatabase.getQuiz(quizId);
            
            // Generate room code and connect
            this.gameState.roomCode = this.generateRoomCode();
            this.gameState.playerName = prompt('Enter your name:') || 'Anonymous';
            this.gameState.isHost = true;
            
            await this.connectWebSocket();
            
            // Send message to create session with existing quiz
            this.sendMessage({
                type: 'play_existing_quiz',
                quizId: quizId,
                playerName: this.gameState.playerName
            });
            
        } catch (error) {
            console.error('Error playing quiz:', error);
            this.showToast('Error loading quiz. Please try again.', 'error');
        }
    }

    async viewHighscores(quizId, quizTopic) {
        try {
            const highscores = await this.quizDatabase.getHighscores(quizId);
            this.showHighscoresModal(quizTopic, highscores);
        } catch (error) {
            console.error('Error loading highscores:', error);
            this.showToast('Error loading highscores.', 'error');
        }
    }

    showHighscoresModal(quizTopic, highscores) {
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'highscores-modal';
        modal.onclick = (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        };
        
        modal.innerHTML = `
            <div class="highscores-content">
                <div class="highscores-header">
                    <h3>Highscores: ${quizTopic}</h3>
                    <button class="close-btn" onclick="document.body.removeChild(this.closest('.highscores-modal'))">×</button>
                </div>
                <ul class="highscore-list">
                    ${highscores.length === 0 ? '<li class="highscore-item">No scores yet. Be the first to play!</li>' : 
                        highscores.map((score, index) => `
                            <li class="highscore-item">
                                <span class="highscore-rank">#${index + 1}</span>
                                <span class="highscore-name">${score.playerName}</span>
                                <span class="highscore-score">
                                    ${score.score} pts
                                    <span class="highscore-percentage">(${score.percentage}%)</span>
                                </span>
                            </li>
                        `).join('')
                    }
                </ul>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 100);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => container.removeChild(toast), 300);
        }, 3000);
    }
}

// Initialize the game when page loads
window.addEventListener('DOMContentLoaded', () => {
    window.quizGame = new QuizGameClient();
}); 