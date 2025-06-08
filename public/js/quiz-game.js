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
                title: quiz.title,
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
        this.startQuizTimeout = null;
        this.playQuizTimeout = null;
        
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
        
        // Form validation for create quiz
        this.setupCreateQuizValidation();
        
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
        
        // Inline results (new buttons)
        document.getElementById('continue-btn').onclick = () => this.nextQuestion();
        document.getElementById('finish-quiz-btn').onclick = () => this.showScreen('final-results');
        
        // Final results screen
        document.getElementById('play-again-btn').onclick = () => this.playAgain();
        document.getElementById('new-quiz-btn').onclick = () => this.showScreen('welcome');
    }

    setupCreateQuizValidation() {
        const form = document.getElementById('create-quiz-form');
        const submitBtn = document.getElementById('generate-quiz-btn');
        const requiredFields = [
            document.getElementById('quiz-title'),
            document.getElementById('quiz-topic'),
            document.getElementById('creator-name')
        ];

        // Function to check if all required fields are filled
        const validateForm = () => {
            const allFieldsFilled = requiredFields.every(field => field.value.trim() !== '');
            submitBtn.disabled = !allFieldsFilled;
        };

        // Initially disable the button
        submitBtn.disabled = true;

        // Add event listeners to all required fields
        requiredFields.forEach(field => {
            field.addEventListener('input', validateForm);
            field.addEventListener('blur', validateForm);
        });

        // Also listen to the select field (question count) in case it's needed
        const questionCountSelect = document.getElementById('question-count');
        questionCountSelect.addEventListener('change', validateForm);
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
            
            // Reset form validation when showing create quiz screen
            if (screenName === 'create-quiz') {
                setTimeout(() => {
                    const submitBtn = document.getElementById('generate-quiz-btn');
                    if (submitBtn) {
                        submitBtn.disabled = true;
                    }
                }, 0);
            }
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
            case 'quiz_loaded':
                this.handleQuizLoaded(data);
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
            case 'quiz_started':
                this.handleQuizStarted(data);
                break;
            case 'error':
                this.hideLoading();
                this.showToast(data.message || 'Server error', 'error');
                break;
            default:
                console.log('❓ Unknown message type:', data.type);
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

    async handleQuizLoaded(data) {
        console.log('🎯 Quiz loaded:', data);
        
        // Clear play quiz timeout
        if (this.playQuizTimeout) {
            clearTimeout(this.playQuizTimeout);
            this.playQuizTimeout = null;
        }
        
        this.hideLoading();
        this.gameState.currentQuiz = data.quiz;
        this.gameState.currentSession = data.session || {
            id: data.sessionId,
            quiz: data.quiz,
            players: {},
            gameState: 'waiting',
            host: this.socket.id || 'host'
        };
        
        this.showToast('Quiz loaded successfully!', 'success');
        this.updateLobbyDisplay();
        this.showScreen('lobby');
    }

    handleSessionUpdate(data) {
        console.log('🔄 Session update received:', data.session.gameState);
        const oldSession = this.gameState.currentSession;
        this.gameState.currentSession = data.session;
        
        // Check if game state changed
        if (oldSession && oldSession.gameState !== data.session.gameState) {
            console.log('🎮 Game state changed from', oldSession.gameState, 'to', data.session.gameState);
            
            if (data.session.gameState === 'playing') {
                // Transition to playing state
                this.handleSessionState(data);
                return;
            } else if (data.session.gameState === 'waiting' && this.currentScreen !== 'lobby') {
                // If we're not in lobby but should be, go there
                console.log('🏠 Transitioning to lobby');
                this.hideLoading();
                this.updateLobbyDisplay();
                this.showScreen('lobby');
                return;
            }
        }
        
        // If this is the first session update after playing a quiz, show lobby
        if (!oldSession && data.session.gameState === 'waiting' && this.currentScreen !== 'lobby') {
            console.log('🏠 First session update - showing lobby');
            
            // Clear play quiz timeout
            if (this.playQuizTimeout) {
                clearTimeout(this.playQuizTimeout);
                this.playQuizTimeout = null;
            }
            
            this.hideLoading();
            this.updateLobbyDisplay();
            this.showScreen('lobby');
            return;
        }
        
        // Update current screen
        if (this.currentScreen === 'lobby') {
            this.updateLobbyDisplay();
        } else if (this.currentScreen === 'quiz') {
            this.updateQuizDisplay();
        }
    }

    handleSessionState(data) {
        console.log('🎮 handleSessionState() called with gameState:', data.session.gameState);
        this.gameState.currentSession = data.session;
        
        if (data.session.gameState === 'waiting') {
            console.log('⏳ Session state: waiting - showing lobby');
            this.hideLoading(); // Hide loading if we're back to waiting
            this.updateLobbyDisplay();
            this.showScreen('lobby');
        } else if (data.session.gameState === 'playing') {
            console.log('🎯 Session state: playing - starting quiz!');
            // Clear timeout and hide loading when quiz starts
            if (this.startQuizTimeout) {
                clearTimeout(this.startQuizTimeout);
                this.startQuizTimeout = null;
            }
            this.hideLoading();
            
            // Set game start time when quiz begins
            if (!this.gameStartTime) {
                this.gameStartTime = Date.now();
            }
            this.updateQuizDisplay();
            this.showScreen('quiz');
            this.startQuestionTimer();
        } else {
            console.log('❓ Unknown session state:', data.session.gameState);
        }
    }

    handleQuestionResults(data) {
        console.log('📊 Question results received:', data);
        
        // Only show results if we're currently in quiz mode
        if (this.currentScreen !== 'quiz') {
            console.log('⚠️ Ignoring question results - not in quiz mode. Current screen:', this.currentScreen);
            return;
        }
        
        this.stopTimer();
        
        // Color code the answer options
        this.colorCodeAnswers(data.currentQuestion.correctAnswer);
        
        // Show inline results
        this.showInlineResults(data);
    }

    colorCodeAnswers(correctAnswerIndex) {
        const answerOptions = document.querySelectorAll('.answer-option');
        const selectedOption = document.querySelector('.answer-option.selected');
        
        answerOptions.forEach((option, index) => {
            // Remove existing color classes
            option.classList.remove('correct', 'incorrect', 'neutral');
            
            if (index === correctAnswerIndex) {
                // This is the correct answer
                option.classList.add('correct');
            } else if (option.classList.contains('selected')) {
                // This was the selected wrong answer
                option.classList.add('incorrect');
            } else {
                // This is a neutral (unselected, incorrect) answer
                option.classList.add('neutral');
            }
        });
    }

    showInlineResults(data) {
        const currentPlayer = this.getCurrentPlayer();
        const session = this.gameState.currentSession;
        
        // Calculate points earned for this question
        let pointsEarned = 0;
        let wasCorrect = false;
        
        if (currentPlayer && data.playerAnswers[currentPlayer.id]) {
            const playerData = data.playerAnswers[currentPlayer.id];
            const previousScore = this.gameState.previousScore || 0;
            pointsEarned = playerData.score - previousScore;
            this.gameState.previousScore = playerData.score;
            wasCorrect = playerData.answer === data.currentQuestion.correctAnswer;
        }
        
        // Update explanation
        const explanationElement = document.getElementById('inline-explanation');
        if (data.currentQuestion.explanation) {
            explanationElement.textContent = data.currentQuestion.explanation;
        } else {
            explanationElement.textContent = `The correct answer is: ${data.currentQuestion.options[data.currentQuestion.correctAnswer]}`;
        }
        
        // Update points display
        const pointsElement = document.getElementById('points-earned');
        const scoreElement = document.getElementById('current-score');
        
        if (pointsEarned > 0) {
            pointsElement.textContent = `+${pointsEarned} points!`;
            pointsElement.style.color = 'var(--secondary-accent-color-2)';
        } else {
            pointsElement.textContent = wasCorrect ? '+0 points' : 'No points';
            pointsElement.style.color = 'var(--text-color-secondary)';
        }
        
        if (currentPlayer) {
            scoreElement.textContent = `Total Score: ${data.playerAnswers[currentPlayer.id]?.score || 0} points`;
        }
        
        // Show appropriate continue button
        const continueBtn = document.getElementById('continue-btn');
        const finishBtn = document.getElementById('finish-quiz-btn');
        
        if (session.currentQuestionIndex >= session.quiz.questions.length - 1) {
            // Last question - show finish button
            finishBtn.classList.remove('hidden');
            continueBtn.classList.add('hidden');
            
            // Save highscores when quiz is finished
            this.saveHighscores(data.playerAnswers);
        } else {
            // More questions - show continue button
            continueBtn.classList.remove('hidden');
            finishBtn.classList.add('hidden');
            
            // Only show continue button for host
            if (!this.isHost()) {
                continueBtn.style.display = 'none';
            }
        }
        
        // Show the inline results section
        document.getElementById('inline-results').classList.remove('hidden');
    }

    handleQuizStarted(data) {
        console.log('🚀 Quiz started:', data);
        
        // Clear timeout and hide loading when quiz starts
        if (this.startQuizTimeout) {
            clearTimeout(this.startQuizTimeout);
            this.startQuizTimeout = null;
        }
        this.hideLoading();
        
        // Update session with the started quiz data
        this.gameState.currentSession = data.session;
        
        // Set game start time when quiz begins
        if (!this.gameStartTime) {
            this.gameStartTime = Date.now();
        }
        
        this.updateQuizDisplay();
        this.showScreen('quiz');
        this.startQuestionTimer();
    }

    updateLobbyDisplay() {
        const session = this.gameState.currentSession;
        if (!session) return;
        
        // Update quiz info
        document.getElementById('quiz-title-display').textContent = session.quiz.title || session.quiz.topic;
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
        
        // Update ready button visibility
        const readyBtn = document.getElementById('ready-btn');
        if (players.length === 1) {
            // Hide ready button when playing solo
            readyBtn.style.display = 'none';
        } else {
            // Show ready button for multiplayer
            readyBtn.style.display = 'block';
        }
        
        // Update host controls
        const hostControls = document.getElementById('host-controls');
        const startBtn = document.getElementById('start-quiz-btn');
        
        if (this.isHost()) {
            hostControls.classList.remove('hidden');
            
            // Enable start button if:
            // 1. Only one player (host can start solo), OR
            // 2. All players are ready
            const canStart = players.length === 1 || (players.length > 0 && players.every(p => p.isReady));
            
            // Only enable if we can start and we're not currently starting
            const isCurrentlyStarting = startBtn.textContent === 'Starting...';
            startBtn.disabled = !canStart || isCurrentlyStarting;
            
            // Update button text based on player count (only if not currently starting)
            if (!isCurrentlyStarting) {
                if (players.length === 1) {
                    startBtn.textContent = 'Start Quiz';
                } else {
                    const readyCount = players.filter(p => p.isReady).length;
                    startBtn.textContent = `Start Quiz (${readyCount}/${players.length} ready)`;
                }
            }
        } else {
            hostControls.classList.add('hidden');
        }
    }

    updateQuizDisplay() {
        const session = this.gameState.currentSession;
        if (!session) {
            console.log('⚠️ No session available for quiz display');
            return;
        }
        
        if (session.gameState !== 'playing') {
            console.log('⚠️ Session not in playing state:', session.gameState);
            return;
        }
        
        const currentQuestionIndex = session.currentQuestionIndex || 0;
        const currentQuestion = session.quiz.questions[currentQuestionIndex];
        
        if (!currentQuestion) {
            console.log('⚠️ No current question available at index:', currentQuestionIndex);
            return;
        }
        
        console.log('📝 Displaying question:', currentQuestionIndex + 1, 'of', session.quiz.questions.length);
        
        // Hide inline results from previous question
        document.getElementById('inline-results').classList.add('hidden');
        
        // Update question info
        document.getElementById('current-question-num').textContent = currentQuestionIndex + 1;
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
        const players = Object.values(session.players || {});
        const answeredCount = players.filter(p => p.hasAnswered).length;
        document.getElementById('players-answered').textContent = answeredCount;
        document.getElementById('total-players-quiz').textContent = players.length;
    }

    selectAnswer(answerIndex) {
        console.log('📝 Selecting answer:', answerIndex);
        
        // Disable all options
        document.querySelectorAll('.answer-option').forEach(btn => {
            btn.disabled = true;
            btn.classList.remove('selected');
        });
        
        // Mark selected option (only if valid index)
        if (answerIndex >= 0) {
            const selectedOption = document.querySelectorAll('.answer-option')[answerIndex];
            if (selectedOption) {
                selectedOption.classList.add('selected');
            }
        }
        
        // Send answer to server
        this.sendMessage({
            type: 'submit_answer',
            answerIndex
        });
        
        if (answerIndex >= 0) {
            this.showToast('Answer submitted!', 'success');
        } else {
            this.showToast('Time expired - no answer submitted', 'info');
        }
    }

    startQuestionTimer() {
        const session = this.gameState.currentSession;
        if (!session) {
            console.log('⚠️ No session for timer');
            return;
        }
        
        // Default to 30 seconds if not specified
        const timeLimit = session.questionTimeLimit || 30;
        this.gameState.timeRemaining = timeLimit;
        
        console.log('⏰ Starting timer with', timeLimit, 'seconds');
        this.updateTimerDisplay();
        
        // Clear any existing timer
        if (this.timer) {
            clearInterval(this.timer);
        }
        
        this.timer = setInterval(() => {
            this.gameState.timeRemaining--;
            this.updateTimerDisplay();
            
            if (this.gameState.timeRemaining <= 0) {
                console.log('⏰ Timer expired');
                this.stopTimer();
                // Auto-submit if no answer selected
                if (!document.querySelector('.answer-option.selected')) {
                    console.log('📝 Auto-submitting no answer');
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
        console.log('🚀 startQuiz() called');
        
        if (!this.isHost()) {
            this.showToast('Only the host can start the quiz', 'error');
            return;
        }
        
        // Prevent multiple clicks
        const startBtn = document.getElementById('start-quiz-btn');
        if (startBtn.disabled) {
            console.log('⚠️ Start button already disabled, ignoring click');
            return;
        }
        
        console.log('✅ Starting quiz...');
        
        // Disable button and show loading
        startBtn.disabled = true;
        startBtn.textContent = 'Starting...';
        
        // Show loading with funny Sims-style messages
        this.showQuizStartLoading();
        
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
        console.log('🔄 showLoading() called with:', message, submessage);
        
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingMessage = document.getElementById('loading-message');
        const loadingSubmessage = document.getElementById('loading-submessage');
        
        if (!loadingOverlay || !loadingMessage || !loadingSubmessage) {
            console.error('❌ Loading elements not found in DOM');
            return;
        }
        
        loadingMessage.textContent = message;
        loadingSubmessage.textContent = submessage;
        loadingOverlay.classList.remove('hidden');
        
        console.log('✅ Loading overlay should now be visible');
    }

    hideLoading() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
            console.log('🔄 Loading overlay hidden');
        } else {
            console.error('❌ Loading overlay not found in DOM');
        }
    }

    showQuizStartLoading() {
        console.log('🎭 showQuizStartLoading() called');
        
        const funnyMessages = [
            "Reticulating splines...",
            "Calibrating fun levels...",
            "Warming up brain cells...",
            "Shuffling question deck...",
            "Consulting the quiz oracle...",
            "Polishing trivia gems...",
            "Awakening sleeping neurons...",
            "Charging knowledge batteries...",
            "Summoning quiz spirits...",
            "Preparing mental gymnastics...",
            "Loading smarty-pants mode...",
            "Activating think-o-matic...",
            "Brewing intelligence potion...",
            "Downloading wisdom packets...",
            "Initializing brain.exe...",
            "Defragmenting memory banks...",
            "Tuning quiz frequencies...",
            "Assembling question particles...",
            "Synchronizing synapses...",
            "Optimizing neural pathways..."
        ];

        const randomMessage = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];
        console.log('🎲 Random message:', randomMessage);
        this.showLoading('Starting Quiz...', randomMessage);
        
        // Safety timeout in case something goes wrong
        if (this.startQuizTimeout) {
            clearTimeout(this.startQuizTimeout);
        }
        
        this.startQuizTimeout = setTimeout(() => {
            this.hideLoading();
            this.showToast('Quiz start is taking longer than expected. Please try again.', 'error');
            
            // Re-enable the start button
            const startBtn = document.getElementById('start-quiz-btn');
            if (startBtn) {
                startBtn.disabled = false;
                this.updateLobbyDisplay(); // This will restore the proper button text
            }
        }, 15000); // 15 second timeout
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
                        <h4 class="quiz-item-title">${quiz.title || quiz.topic}</h4>
                        <p class="quiz-item-topic">${quiz.topic}</p>
                        <p class="quiz-item-creator">Created by ${quiz.createdBy}</p>
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
            console.log('🎮 Playing quiz:', quizId);
            
            // Show loading
            this.showLoading('Loading quiz...', 'Preparing your quiz experience...');
            
            const quiz = await this.quizDatabase.getQuiz(quizId);
            console.log('📚 Quiz loaded from database:', quiz);
            
            // Get player name
            const playerName = await this.showPrompt('Enter your name:', 'Player Name');
            if (!playerName) {
                this.hideLoading();
                return;
            }
            
            // Generate room code and connect
            this.gameState.roomCode = this.generateRoomCode();
            this.gameState.playerName = playerName.trim();
            this.gameState.isHost = true;
            
            console.log('🔌 Connecting to WebSocket...');
            await this.connectWebSocket();
            
            // Send message to create session with existing quiz
            console.log('📤 Sending play_existing_quiz message...');
            this.sendMessage({
                type: 'play_existing_quiz',
                quizId: quizId,
                quiz: quiz, // Send the full quiz data
                playerName: this.gameState.playerName
            });
            
            // Set timeout for loading
            if (this.playQuizTimeout) {
                clearTimeout(this.playQuizTimeout);
            }
            
            this.playQuizTimeout = setTimeout(() => {
                this.hideLoading();
                this.showToast('Quiz loading is taking longer than expected. Please try again.', 'error');
                console.log('⏰ Play quiz timeout');
            }, 10000); // 10 second timeout
            
        } catch (error) {
            console.error('❌ Error playing quiz:', error);
            this.hideLoading();
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

    // Custom Alert Modal (replaces browser alert)
    showAlert(message, title = 'Alert') {
        return new Promise((resolve) => {
            const modal = document.getElementById('alert-modal');
            const messageEl = document.getElementById('alert-message');
            const titleEl = modal.querySelector('.modal-title');
            const okBtn = document.getElementById('alert-ok-btn');
            
            // Set content
            messageEl.textContent = message;
            titleEl.textContent = title;
            
            // Show modal
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.add('show'), 10);
            
            // Handle close
            const closeModal = () => {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.classList.add('hidden');
                    resolve();
                }, 250);
            };
            
            // Event listeners
            okBtn.onclick = closeModal;
            modal.onclick = (e) => {
                if (e.target === modal) closeModal();
            };
            
            // ESC key support
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                    document.removeEventListener('keydown', handleEsc);
                }
            };
            document.addEventListener('keydown', handleEsc);
        });
    }

    // Custom Confirm Modal (replaces browser confirm)
    showConfirm(message, title = 'Confirm', options = {}) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            const messageEl = document.getElementById('confirm-message');
            const titleEl = modal.querySelector('.modal-title');
            const cancelBtn = document.getElementById('confirm-cancel-btn');
            const confirmBtn = document.getElementById('confirm-ok-btn');
            
            // Set content
            messageEl.textContent = message;
            titleEl.textContent = title;
            
            // Configure buttons
            cancelBtn.textContent = options.cancelText || 'Cancel';
            confirmBtn.textContent = options.confirmText || 'Confirm';
            
            // Add danger styling if specified
            if (options.danger) {
                confirmBtn.classList.add('danger');
            } else {
                confirmBtn.classList.remove('danger');
            }
            
            // Show modal
            modal.classList.remove('hidden');
            setTimeout(() => modal.classList.add('show'), 10);
            
            // Handle close
            const closeModal = (result) => {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.classList.add('hidden');
                    resolve(result);
                }, 250);
            };
            
            // Event listeners
            cancelBtn.onclick = () => closeModal(false);
            confirmBtn.onclick = () => closeModal(true);
            modal.onclick = (e) => {
                if (e.target === modal) closeModal(false);
            };
            
            // ESC key support
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    closeModal(false);
                    document.removeEventListener('keydown', handleEsc);
                }
            };
            document.addEventListener('keydown', handleEsc);
        });
    }

    // Custom Prompt Modal (replaces browser prompt)
    showPrompt(message, title = 'Input Required', placeholder = 'Enter value...') {
        return new Promise((resolve) => {
            const modal = document.getElementById('prompt-modal');
            const messageEl = document.getElementById('prompt-message');
            const titleEl = modal.querySelector('.modal-title');
            const inputEl = document.getElementById('prompt-input');
            const cancelBtn = document.getElementById('prompt-cancel-btn');
            const okBtn = document.getElementById('prompt-ok-btn');
            
            // Set content
            messageEl.textContent = message;
            titleEl.textContent = title;
            inputEl.placeholder = placeholder;
            inputEl.value = '';
            
            // Show modal
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.add('show');
                inputEl.focus();
            }, 10);
            
            // Handle close
            const closeModal = (result) => {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.classList.add('hidden');
                    resolve(result);
                }, 250);
            };
            
            // Event listeners
            cancelBtn.onclick = () => closeModal(null);
            okBtn.onclick = () => {
                const value = inputEl.value.trim();
                closeModal(value || null);
            };
            modal.onclick = (e) => {
                if (e.target === modal) closeModal(null);
            };
            
            // Enter key support
            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const value = inputEl.value.trim();
                    closeModal(value || null);
                }
            };
            
            // ESC key support
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    closeModal(null);
                    document.removeEventListener('keydown', handleEsc);
                }
            };
            document.addEventListener('keydown', handleEsc);
        });
    }
}

// Initialize the game when page loads
window.addEventListener('DOMContentLoaded', () => {
    window.quizGame = new QuizGameClient();
}); 