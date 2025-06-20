// Import Firebase functions
import { ref, push, set, get, query, orderByChild, limitToLast, update } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// Error handling and retry logic utilities
class ErrorHandler {
    static MAX_RETRIES = 3;
    static BASE_DELAY = 1000;
    static MAX_DELAY = 10000;

    static async retry(operation, operationName, maxRetries = this.MAX_RETRIES) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 ${operationName} - Attempt ${attempt + 1}/${maxRetries + 1}`);
                return await operation();
            } catch (error) {
                lastError = error;
                
                const errorInfo = this.categorizeError(error);
                console.warn(`⚠️ ${operationName} failed (attempt ${attempt + 1}):`, {
                    type: errorInfo.type,
                    message: errorInfo.message,
                    retryable: errorInfo.retryable
                });
                
                // Don't retry if error is not retryable or we're on the last attempt
                if (!errorInfo.retryable || attempt === maxRetries) {
                    break;
                }
                
                // Calculate and apply backoff delay
                const delayMs = this.calculateBackoffDelay(attempt);
                console.log(`⏳ Waiting ${delayMs}ms before retry...`);
                await this.delay(delayMs);
            }
        }
        
        console.error(`❌ ${operationName} failed after ${maxRetries + 1} attempts:`, lastError);
        throw lastError;
    }

    static categorizeError(error) {
        // Network errors
        if (error.name === 'NetworkError' || error.code === 'NETWORK_ERROR') {
            return {
                type: 'network',
                message: 'Network connection failed',
                retryable: true,
                userMessage: 'Connection issue. Please check your internet connection.'
            };
        }
        
        // WebSocket errors
        if (error.name === 'WebSocketError' || error.type === 'websocket') {
            return {
                type: 'websocket',
                message: 'WebSocket connection failed',
                retryable: true,
                userMessage: 'Connection to game server lost. Attempting to reconnect...'
            };
        }
        
        // AI/API errors
        if (error.message?.includes('AI') || error.message?.includes('assistant')) {
            return {
                type: 'ai',
                message: error.message,
                retryable: !error.message.includes('AUTH_ERROR'),
                userMessage: 'AI service temporarily unavailable. Please try again.'
            };
        }
        
        // Validation errors (user input)
        if (error.name === 'ValidationError') {
            return {
                type: 'validation',
                message: error.message,
                retryable: false,
                userMessage: error.message
            };
        }
        
        // Generic errors
        return {
            type: 'unknown',
            message: error.message || 'Unknown error occurred',
            retryable: true,
            userMessage: 'Something went wrong. Please try again.'
        };
    }

    static calculateBackoffDelay(attempt) {
        const delay = Math.min(
            this.BASE_DELAY * Math.pow(2, attempt),
            this.MAX_DELAY
        );
        // Add jitter to prevent thundering herd
        return delay + Math.random() * 1000;
    }

    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static showUserError(error, fallbackMessage = 'An error occurred. Please try again.') {
        const errorInfo = this.categorizeError(error);
        const message = errorInfo.userMessage || fallbackMessage;
        
        // Show user-friendly error message
        this.showErrorToast(message);
        
        // Log technical details for debugging
        console.error('User error:', {
            type: errorInfo.type,
            message: errorInfo.message,
            original: error
        });
    }

    static showErrorToast(message) {
        // Create or update error toast
        let toast = document.getElementById('error-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'error-toast';
            toast.className = 'error-toast';
            toast.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #ff4444;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                z-index: 10000;
                display: none;
                opacity: 0;
                transition: opacity 0.3s ease;
                max-width: 300px;
                word-wrap: break-word;
                font-family: system-ui, -apple-system, sans-serif;
            `;
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.style.display = 'block';
        setTimeout(() => {
            toast.style.opacity = '1';
        }, 10);
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 300);
        }, 5000);
    }
}

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
            
            // Calculate correct answers from points (100 points per correct answer)
            const correctAnswers = Math.floor(score / 100);
            const percentage = Math.round((correctAnswers / totalQuestions) * 100);
            
            const scoreData = {
                playerName: playerName,
                score: score, // Keep the actual points scored
                correctAnswers: correctAnswers, // Number of correct answers
                totalQuestions: totalQuestions,
                percentage: percentage, // Percentage based on correct answers
                timeSpent: timeSpent,
                timestamp: Date.now()
            };
            
            await set(newScoreRef, scoreData);
            await this.updateQuizStats(quizId, correctAnswers, totalQuestions);
            
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
                    // If scores are equal, sort by timestamp (most recent first)
                    return b.timestamp - a.timestamp;
                }).slice(0, limit);
            } else {
                return [];
            }
        } catch (error) {
            console.error('Error getting highscores:', error);
            throw error;
        }
    }

    async updateQuizStats(quizId, correctAnswers, totalQuestions) {
        try {
            const quizRef = ref(this.db, `quizzes/${quizId}`);
            const snapshot = await get(quizRef);
            
            if (snapshot.exists()) {
                const quiz = snapshot.val();
                const currentPlayCount = quiz.playCount || 0;
                const currentAverage = quiz.averageScore || 0;
                
                const newPlayCount = currentPlayCount + 1;
                const percentage = (correctAnswers / totalQuestions) * 100;
                const newAverage = ((currentAverage * currentPlayCount) + percentage) / newPlayCount;
                
                await update(quizRef, {
                    playCount: newPlayCount,
                    averageScore: Math.round(newAverage * 100) / 100
                });
                
                console.log(`📊 Quiz stats updated: ${quizId} - Play count: ${newPlayCount}, Average: ${Math.round(newAverage * 100) / 100}%`);
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

    // Get session statistics for a quiz
    async getSessionStats(quizId) {
        try {
            const sessionStatsRef = ref(this.db, `sessionStats/${quizId}`);
            const snapshot = await get(sessionStatsRef);
            
            if (snapshot.exists()) {
                const sessions = [];
                snapshot.forEach((childSnapshot) => {
                    sessions.push(childSnapshot.val());
                });
                
                // Calculate total unique players and sessions
                const totalSessions = sessions.length;
                const totalPlayers = sessions.reduce((sum, session) => sum + session.playerCount, 0);
                const averagePlayersPerSession = totalSessions > 0 ? Math.round((totalPlayers / totalSessions) * 100) / 100 : 0;
                
                return {
                    totalSessions,
                    totalPlayers,
                    averagePlayersPerSession,
                    sessions: sessions.sort((a, b) => b.timestamp - a.timestamp)
                };
            } else {
                return {
                    totalSessions: 0,
                    totalPlayers: 0,
                    averagePlayersPerSession: 0,
                    sessions: []
                };
            }
        } catch (error) {
            console.error('Error getting session stats:', error);
            throw error;
        }
    }
}

// Quizaru Game Client
class QuizGameClient {
    constructor() {
        // Prevent multiple initialization
        if (window.quizGameInitialized) {
            console.log('⚠️ QuizGame already initialized, skipping...');
            return window.quizGame;
        }
        
        this.socket = null;
        this.gameState = {
            roomCode: '',
            playerName: '',
            isHost: false,
            players: {},
            currentQuiz: null,
            currentSession: null,
            currentQuestionIndex: -1
        };
        this.currentScreen = 'welcome';
        this.quizDatabase = new QuizDatabase();
        this.gameStartTime = null;
        this.startQuizTimeout = null;
        this.playQuizTimeout = null;
        
        // Browser history management
        this.navigationStack = ['welcome'];
        this.isNavigatingBack = false;
        
        // Mark as initialized and store reference
        window.quizGameInitialized = true;
        window.quizGame = this;
        
        this.init();
    }

    async init() {
        console.log('🎮 Initializing Quizaru...');
        
        // Wait for Firebase to be ready
        await this.quizDatabase.waitForFirebase();
        
        // Verify modal elements exist
        this.verifyModalElements();
        
        this.setupEventListeners();
        
        // Check URL parameters for initial navigation
        const urlParams = new URLSearchParams(window.location.search);
        const screenParam = urlParams.get('screen');
        const roomCode = urlParams.get('room');
        
        // Initialize browser history state
        this.initializeBrowserHistory();
        
        // Navigate to appropriate screen
        if (roomCode) {
            this.showJoinInterface(roomCode);
        } else if (screenParam && this.isValidScreen(screenParam)) {
            this.showScreen(screenParam);
        } else {
            this.showScreen('welcome');
        }
        
        console.log('✅ Quizaru initialized successfully');
    }

    initializeBrowserHistory() {
        // Set initial history state if none exists
        if (!window.history.state) {
            const initialState = {
                screen: 'welcome',
                previousScreen: null,
                timestamp: Date.now(),
                gameState: null
            };
            
            const url = new URL(window.location);
            if (!url.searchParams.has('screen')) {
                url.searchParams.set('screen', 'welcome');
            }
            
            window.history.replaceState(initialState, '', url.toString());
            console.log('📚 Initialized browser history state');
        }
    }

    isValidScreen(screenName) {
        const validScreens = [
            'welcome',
            'create-quiz',
            'create-tournament',
            'browse-quizzes',
            'join-session',
            'lobby',
            'quiz',
            'results',
            'final-results'
        ];
        return validScreens.includes(screenName);
    }

    shouldPreventNavigation() {
        // Prevent navigation during active quiz gameplay
        if (this.currentScreen === 'quiz' && this.gameState.gameStarted) {
            return true;
        }
        
        // Prevent navigation during quiz creation/loading
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
            return true;
        }
        
        return false;
    }

    setupEventListeners() {
        // Browser back/forward button support
        window.addEventListener('popstate', (event) => {
            this.handleBrowserNavigation(event);
        });
        
        // Header navigation - Quizaru logo click
        document.querySelector('.navbar-brand').onclick = (e) => {
            e.preventDefault();
            this.goToHomeScreen();
        };
        
        // Welcome screen
        document.getElementById('create-quiz-option').onclick = () => this.showScreen('create-quiz');
        document.getElementById('create-tournament-option').onclick = () => this.showCreateTournament();
        document.getElementById('browse-quizzes-option').onclick = () => this.showBrowseQuizzes();
        document.getElementById('join-quiz-option').onclick = () => this.showScreen('join-session');
        
        // Create quiz screen
        document.getElementById('create-quiz-form').onsubmit = (e) => this.handleCreateQuiz(e);
        document.getElementById('back-to-welcome').onclick = () => this.navigateBack();
        
        // Language selection handling
        document.getElementById('quiz-language').onchange = () => this.handleLanguageSelection();
        
        // Create tournament screen
        document.getElementById('tournament-form').onsubmit = (e) => this.handleCreateTournament(e);
        document.getElementById('back-to-welcome-tournament').onclick = () => this.navigateBack();
        
        // Form validation for create quiz
        this.setupCreateQuizValidation();
        
        // Browse quizzes screen
        document.getElementById('back-to-welcome-3').onclick = () => this.navigateBack();
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
        document.getElementById('back-to-welcome-2').onclick = () => this.navigateBack();
        
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
        document.getElementById('new-quiz-btn').onclick = () => this.goToHomeScreen();
    }

    setupCreateQuizValidation() {
        const form = document.getElementById('create-quiz-form');
        const submitBtn = document.getElementById('generate-quiz-btn');
        const titleField = document.getElementById('quiz-title');
        const topicField = document.getElementById('quiz-topic');
        const creatorField = document.getElementById('creator-name');
        const questionCountSelect = document.getElementById('question-count');
        
        const customLanguageField = document.getElementById('custom-language');
        const requiredFields = [titleField, topicField, creatorField];

        // Create content validation elements
        this.createContentValidationElements();

        // Function to check if all required fields are filled and content is appropriate
        const validateForm = () => {
            const languageSelect = document.getElementById('quiz-language');
            const isCustomLanguage = languageSelect && languageSelect.value === 'custom';
            const customLanguageRequired = isCustomLanguage && (!customLanguageField || customLanguageField.value.trim() === '');
            
            const allFieldsFilled = requiredFields.every(field => field && field.value.trim() !== '') && !customLanguageRequired;
            
            // Content moderation validation
            let contentValid = true;
            let contentMessage = '';
            
            if (topicField && topicField.value.trim()) {
                const moderation = ClientContentModerator.validateTopic(
                    topicField.value.trim(), 
                    titleField ? titleField.value.trim() : ''
                );
                contentValid = moderation.isValid;
                contentMessage = moderation.message;
                
                // Only show feedback if content is invalid
                if (!contentValid) {
                    this.updateContentValidationFeedback(moderation);
                    this.showContentSuggestions();
                } else {
                    // Hide feedback and suggestions when content is valid
                    const feedbackDiv = document.getElementById('content-validation-feedback');
                    if (feedbackDiv) {
                        feedbackDiv.style.display = 'none';
                    }
                    
                    const suggestionsDiv = document.getElementById('topic-suggestions');
                    if (suggestionsDiv) {
                        suggestionsDiv.remove();
                    }
                }
            }
            
            const isFormValid = allFieldsFilled && contentValid;
            
            if (submitBtn) {
                submitBtn.disabled = !isFormValid;
                
                // Force white text color when disabled
                if (submitBtn.disabled) {
                    const btnText = submitBtn.querySelector('.btn-text');
                    if (btnText) {
                        btnText.style.color = 'white';
                        btnText.style.setProperty('color', 'white', 'important');
                    }
                    submitBtn.style.color = 'white';
                    submitBtn.style.setProperty('color', 'white', 'important');
                } else {
                    const btnText = submitBtn.querySelector('.btn-text');
                    if (btnText) {
                        btnText.style.color = '';
                    }
                    submitBtn.style.color = '';
                }
                
                if (!contentValid && topicField && topicField.value.trim()) {
                    submitBtn.title = contentMessage;
                } else {
                    submitBtn.title = '';
                }
            }
        };

        // Initially disable the button
        if (submitBtn) {
        submitBtn.disabled = true;
            
            // Force white text color on disabled button
            const btnText = submitBtn.querySelector('.btn-text');
            if (btnText) {
                btnText.style.color = 'white';
                btnText.style.setProperty('color', 'white', 'important');
            }
            submitBtn.style.color = 'white';
            submitBtn.style.setProperty('color', 'white', 'important');
        }

        // Add event listeners to all required fields
        requiredFields.forEach(field => {
            if (field) {
            field.addEventListener('input', validateForm);
            field.addEventListener('blur', validateForm);
            }
        });

        // Also listen to the select field (question count)
        if (questionCountSelect) {
        questionCountSelect.addEventListener('change', validateForm);
    }

        // Add language field listeners
        const languageSelect = document.getElementById('quiz-language');
        if (languageSelect) {
            languageSelect.addEventListener('change', validateForm);
        }
        if (customLanguageField) {
            customLanguageField.addEventListener('input', validateForm);
            customLanguageField.addEventListener('blur', validateForm);
        }

        // Content guidelines removed - validation handled directly
    }

    createContentValidationElements() {
        const topicField = document.getElementById('quiz-topic');
        if (!topicField) return;
        
        // Add content validation feedback after topic input
        if (!document.getElementById('content-validation-feedback')) {
            const feedbackDiv = document.createElement('div');
            feedbackDiv.id = 'content-validation-feedback';
            feedbackDiv.style.cssText = `
                margin-top: 8px;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                display: none;
                transition: all 0.3s ease;
            `;
            topicField.parentNode.insertBefore(feedbackDiv, topicField.nextSibling);
        }
    }

    updateContentValidationFeedback(moderation) {
        const feedbackDiv = document.getElementById('content-validation-feedback');
        if (!feedbackDiv) return;
        
        if (moderation.isValid) {
            feedbackDiv.style.display = 'block';
            feedbackDiv.style.background = '#d4edda';
            feedbackDiv.style.border = '1px solid #c3e6cb';
            feedbackDiv.style.color = '#155724';
            feedbackDiv.innerHTML = `✅ ${moderation.message}`;
        } else {
            feedbackDiv.style.display = 'block';
            feedbackDiv.style.background = moderation.severity === 'high' ? '#f8d7da' : '#fff3cd';
            feedbackDiv.style.border = moderation.severity === 'high' ? '1px solid #f5c6cb' : '1px solid #ffeaa7';
            feedbackDiv.style.color = moderation.severity === 'high' ? '#721c24' : '#856404';
            feedbackDiv.innerHTML = `
                ${moderation.severity === 'high' ? '❌' : '⚠️'} ${moderation.message}
                ${moderation.suggestion ? `<br><strong>Suggestion:</strong> ${moderation.suggestion}` : ''}
            `;
        }
    }

    showContentSuggestions() {
        if (document.getElementById('topic-suggestions')) return;
        
        const topicField = document.getElementById('quiz-topic');
        if (!topicField) return;
        
        const suggestionsDiv = document.createElement('div');
        suggestionsDiv.id = 'topic-suggestions';
        suggestionsDiv.innerHTML = `
            <div style="margin-top: 16px; padding: 16px; background: #e8f4fd; border-radius: 8px; border-left: 4px solid #007bff;">
                <h4 style="margin: 0 0 12px 0; color: #004085; font-size: 16px;">
                    💡 Suggested Topics
                </h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-size: 14px;">
                    ${ClientContentModerator.getSuggestedTopics().map(topic => 
                        `<button type="button" class="topic-suggestion-btn" style="
                            padding: 8px 12px;
                            background: white;
                            border: 1px solid #007bff;
                            border-radius: 6px;
                            color: #007bff;
                            cursor: pointer;
                            text-align: left;
                            transition: all 0.2s ease;
                        " onmouseover="this.style.background='#007bff'; this.style.color='white';" 
                           onmouseout="this.style.background='white'; this.style.color='#007bff';"
                           onclick="window.quizGame.selectSuggestedTopic('${topic}')">${topic}</button>`
                    ).join('')}
                </div>
            </div>
        `;
        
        const feedbackDiv = document.getElementById('content-validation-feedback');
        if (feedbackDiv && feedbackDiv.parentNode) {
            feedbackDiv.parentNode.insertBefore(suggestionsDiv, feedbackDiv.nextSibling);
        }
    }

    selectSuggestedTopic(topic) {
        const topicField = document.getElementById('quiz-topic');
        if (topicField) {
            topicField.value = topic;
            topicField.dispatchEvent(new Event('input'));
        }
        
        // Remove suggestions after selection
        const suggestionsDiv = document.getElementById('topic-suggestions');
        if (suggestionsDiv) {
            suggestionsDiv.remove();
        }
    }

    // Content guidelines removed - validation is now handled directly through button state
    // showContentGuidelines() method no longer needed

    handleLanguageSelection() {
        const languageSelect = document.getElementById('quiz-language');
        const customLanguageGroup = document.getElementById('custom-language-group');
        const customLanguageInput = document.getElementById('custom-language');
        
        if (languageSelect.value === 'custom') {
            customLanguageGroup.style.display = 'block';
            customLanguageInput.required = true;
        } else {
            customLanguageGroup.style.display = 'none';
            customLanguageInput.required = false;
            customLanguageInput.value = '';
        }
    }

    showScreen(screenName, addToHistory = true) {
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
            
            const previousScreen = this.currentScreen;
            this.currentScreen = screenName;
            console.log(`Switched to ${screenName} screen`);
            
            // Manage browser history
            if (addToHistory && !this.isNavigatingBack) {
                this.pushToHistory(screenName, previousScreen);
            }
            
            // Reset form validation when showing create quiz screen
            if (screenName === 'create-quiz') {
                setTimeout(() => {
                    const submitBtn = document.getElementById('generate-quiz-btn');
                    if (submitBtn) {
                        submitBtn.disabled = true;
                    }
                }, 0);
            }
            
            // Update page title based on screen
            this.updatePageTitle(screenName);
        }
    }

    pushToHistory(screenName, previousScreen) {
        // Prevent adding the same screen consecutively
        const lastScreen = this.navigationStack[this.navigationStack.length - 1];
        if (lastScreen === screenName) {
            console.log(`📚 Skipping duplicate history entry for: ${screenName}`);
            return;
        }
        
        // Create state object with screen information
        const state = {
            screen: screenName,
            previousScreen: previousScreen,
            timestamp: Date.now(),
            gameState: this.gameState ? { ...this.gameState } : null
        };
        
        // Generate URL with screen parameter
        const url = new URL(window.location);
        url.searchParams.set('screen', screenName);
        
        // Add room code to URL if available
        if (this.gameState.roomCode) {
            url.searchParams.set('room', this.gameState.roomCode);
        } else {
            url.searchParams.delete('room');
        }
        
        // Push to browser history
        window.history.pushState(state, '', url.toString());
        
        // Update navigation stack
        this.navigationStack.push(screenName);
        
        console.log(`📚 Added to history: ${screenName}, Stack:`, this.navigationStack);
    }

    handleBrowserNavigation(event) {
        console.log('🔙 Browser navigation detected', event.state);
        
        // Check if we should prevent navigation during critical game states
        if (this.shouldPreventNavigation()) {
            console.log('🚫 Navigation prevented during critical game state');
            // Push current state back to maintain history
            const currentState = {
                screen: this.currentScreen,
                previousScreen: null,
                timestamp: Date.now(),
                gameState: this.gameState ? { ...this.gameState } : null
            };
            window.history.pushState(currentState, '', window.location.href);
            return;
        }
        
        this.isNavigatingBack = true;
        
        if (event.state && event.state.screen) {
            // Navigate to the screen from history
            const targetScreen = event.state.screen;
            console.log(`🔙 Navigating back to: ${targetScreen}`);
            
            // Restore game state if available
            if (event.state.gameState) {
                this.gameState = { ...this.gameState, ...event.state.gameState };
            }
            
            // Show the screen without adding to history
            this.showScreen(targetScreen, false);
            
            // Update navigation stack
            const stackIndex = this.navigationStack.lastIndexOf(targetScreen);
            if (stackIndex !== -1) {
                this.navigationStack = this.navigationStack.slice(0, stackIndex + 1);
            }
        } else {
            // No state, go to welcome screen
            console.log('🔙 No state found, going to welcome');
            this.showScreen('welcome', false);
            this.navigationStack = ['welcome'];
        }
        
        setTimeout(() => {
            this.isNavigatingBack = false;
        }, 100);
    }

    updatePageTitle(screenName) {
        const titles = {
            'welcome': 'Quizaru - Interactive Quiz Game',
            'create-quiz': 'Create Quiz - Quizaru',
            'create-tournament': 'Create Tournament - Quizaru',
            'browse-quizzes': 'Browse Quizzes - Quizaru',
            'join-session': 'Join Session - Quizaru',
            'lobby': 'Quiz Lobby - Quizaru',
            'quiz': 'Playing Quiz - Quizaru',
            'results': 'Quiz Results - Quizaru',
            'final-results': 'Final Results - Quizaru'
        };
        
        document.title = titles[screenName] || 'Quizaru - Interactive Quiz Game';
    }

    canNavigateBack() {
        return this.navigationStack.length > 1;
    }

    navigateBack() {
        if (this.canNavigateBack()) {
            // Remove current screen from stack
            this.navigationStack.pop();
            
            // Get previous screen
            const previousScreen = this.navigationStack[this.navigationStack.length - 1];
            
            console.log(`🔙 Manual back navigation to: ${previousScreen}`);
            
            // Use browser back if possible, otherwise navigate directly
            if (window.history.length > 1) {
                window.history.back();
            } else {
                this.showScreen(previousScreen, false);
            }
        } else {
            console.log('🔙 Cannot navigate back, already at root');
        }
    }

    goToHomeScreen() {
        console.log('🏠 Navigating to home screen');
        
        // Hide loading overlay if it's showing
        this.hideLoading();
        
        // Close any open modals
        const modals = document.querySelectorAll('.modal-overlay, .highscores-modal');
        modals.forEach(modal => {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        });
        
        // Clear any timeouts
        if (this.playQuizTimeout) {
            clearTimeout(this.playQuizTimeout);
            this.playQuizTimeout = null;
        }
        
        // Disconnect WebSocket if connected
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('🔌 Disconnecting WebSocket');
            this.ws.close();
            this.ws = null;
        }
        
        // Reset game state
        this.gameState = {
            roomCode: null,
            playerName: null,
            isHost: false,
            currentQuiz: null,
            currentSession: null,
            currentQuestionIndex: 0,
            selectedAnswer: null,
            playerAnswers: [],
            gameStarted: false
        };
        
        // Clear any form data
        const forms = document.querySelectorAll('form');
        forms.forEach(form => form.reset());
        
        // Reset navigation stack
        this.navigationStack = ['welcome'];
        
        // Show welcome screen
        this.showScreen('welcome');
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
        const languageSelect = document.getElementById('quiz-language').value;
        const customLanguage = document.getElementById('custom-language').value.trim();
        
        // Determine the language to use
        let language = languageSelect;
        if (languageSelect === 'custom') {
            if (!customLanguage) {
                this.showToast('Please specify a custom language', 'error');
                return;
            }
            language = customLanguage;
        }
        
        if (!title || !topic || !creatorName) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }
        
        if (questionCount < 5 || questionCount > 15) {
            this.showToast('Number of questions must be between 5 and 15', 'error');
            return;
        }
        
        // Final content validation before submission
        const moderation = ClientContentModerator.validateTopic(topic, title);
        if (!moderation.isValid) {
            this.showAlert(
                `${moderation.message}\n\n${moderation.suggestion || 'Please choose a different topic.'}`,
                'Content Policy Violation'
            );
            return;
        }
        
        // Show loading
        this.showLoading('Generating your quiz...', 'AI is creating questions based on your topic');
        
        // Generate room code and connect
        this.gameState.roomCode = this.generateRoomCode();
        this.gameState.playerName = creatorName;
        this.gameState.isHost = true;
        
        try {
            await ErrorHandler.retry(async () => {
            await this.connectWebSocket();
            
            // Send create quiz message
            this.sendMessage({
                type: 'create_quiz',
                title,
                topic,
                questionCount,
                playerName: creatorName,
                language
            });
            }, 'Create Quiz');
        } catch (error) {
            this.hideLoading();
            
            // Handle content moderation errors specifically
            if (error.message && (
                error.message.includes('inappropriate content') ||
                error.message.includes('violates content guidelines') ||
                error.message.includes('Content moderation failed') ||
                error.message.includes('rejected by AI moderation')
            )) {
                this.showAlert(
                    'The quiz topic or generated content was flagged as inappropriate. Please try a different topic that follows our content guidelines.',
                    'Content Moderation'
                );
            } else {
                ErrorHandler.showUserError(error, 'Failed to create quiz. Please try again.');
            }
            
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

    async showCreateTournament() {
        console.log('🏆 Showing tournament creation screen');
        this.showScreen('create-tournament');
        
        // Load available quizzes for selection
        await this.loadAvailableQuizzesForTournament();
    }

    async loadAvailableQuizzesForTournament() {
        const availableQuizzesContainer = document.getElementById('available-quizzes');
        
        try {
            // Show loading state
            availableQuizzesContainer.innerHTML = `
                <div class="loading-quizzes">
                    <div class="loading-spinner"></div>
                    <p>Loading available quizzes...</p>
                </div>
            `;
            
            // Get all quizzes from Firebase
            const quizzes = await this.quizDatabase.getAllQuizzes();
            
            if (quizzes.length === 0) {
                availableQuizzesContainer.innerHTML = `
                    <div class="no-quizzes">
                        <p>No quizzes available. Create some quizzes first!</p>
                        <button class="btn btn-primary" onclick="window.quizGame.showScreen('create-quiz')">Create Quiz</button>
                    </div>
                `;
                return;
            }
            
            // Display quizzes
            availableQuizzesContainer.innerHTML = '<h4>Available Quizzes</h4>';
            
            quizzes.forEach(quiz => {
                const quizElement = document.createElement('div');
                quizElement.className = 'selectable-quiz';
                quizElement.dataset.quizId = quiz.id;
                
                quizElement.innerHTML = `
                    <div class="selectable-quiz-title">${quiz.title || quiz.topic}</div>
                    <div class="selectable-quiz-topic">${quiz.topic}</div>
                    <div class="selectable-quiz-stats">
                        <span>${quiz.questions.length} questions</span>
                        <span>by ${quiz.createdBy}</span>
                        ${quiz.language ? `<span>${this.getLanguageDisplay(quiz.language)}</span>` : ''}
                    </div>
                `;
                
                quizElement.onclick = () => this.toggleQuizSelection(quiz, quizElement);
                availableQuizzesContainer.appendChild(quizElement);
            });
            
        } catch (error) {
            console.error('❌ Error loading quizzes for tournament:', error);
            availableQuizzesContainer.innerHTML = `
                <div class="error-loading">
                    <p>Failed to load quizzes. Please try again.</p>
                    <button class="btn btn-outline" onclick="window.quizGame.loadAvailableQuizzesForTournament()">Retry</button>
                </div>
            `;
        }
    }

    toggleQuizSelection(quiz, element) {
        const isSelected = element.classList.contains('selected');
        
        if (isSelected) {
            // Remove from selection
            element.classList.remove('selected');
            this.removeQuizFromTournament(quiz.id);
        } else {
            // Add to selection
            element.classList.add('selected');
            this.addQuizToTournament(quiz);
        }
    }

    addQuizToTournament(quiz) {
        // Initialize selected quizzes array if not exists
        if (!this.selectedTournamentQuizzes) {
            this.selectedTournamentQuizzes = [];
        }
        
        // Check if already selected
        if (this.selectedTournamentQuizzes.find(q => q.id === quiz.id)) {
            return;
        }
        
        this.selectedTournamentQuizzes.push(quiz);
        this.updateSelectedQuizzesDisplay();
        this.updateTournamentInfo();
        this.updateCreateTournamentButton();
    }

    removeQuizFromTournament(quizId) {
        if (!this.selectedTournamentQuizzes) return;
        
        this.selectedTournamentQuizzes = this.selectedTournamentQuizzes.filter(q => q.id !== quizId);
        this.updateSelectedQuizzesDisplay();
        this.updateTournamentInfo();
        this.updateCreateTournamentButton();
        
        // Update the visual state of the quiz in available list
        const quizElement = document.querySelector(`[data-quiz-id="${quizId}"]`);
        if (quizElement) {
            quizElement.classList.remove('selected');
        }
    }

    updateSelectedQuizzesDisplay() {
        const selectedContainer = document.getElementById('selected-quizzes');
        const selectedCount = document.getElementById('selected-quiz-count');
        
        if (!this.selectedTournamentQuizzes || this.selectedTournamentQuizzes.length === 0) {
            selectedContainer.innerHTML = `
                <div class="empty-selection">
                    <i class="ph ph-selection-plus"></i>
                    <p>Select quizzes from the left to add them to your tournament</p>
                </div>
            `;
            selectedCount.textContent = '0';
            return;
        }
        
        selectedCount.textContent = this.selectedTournamentQuizzes.length;
        selectedContainer.innerHTML = '';
        
        this.selectedTournamentQuizzes.forEach(quiz => {
            const quizItem = document.createElement('div');
            quizItem.className = 'selected-quiz-item';
            
            quizItem.innerHTML = `
                <div class="selected-quiz-info">
                    <div class="selected-quiz-title">${quiz.title || quiz.topic}</div>
                    <div class="selected-quiz-details">${quiz.questions.length} questions • by ${quiz.createdBy}${quiz.language ? ` • ${this.getLanguageDisplay(quiz.language)}` : ''}</div>
                </div>
                <button class="remove-quiz-btn" onclick="window.quizGame.removeQuizFromTournament('${quiz.id}')" title="Remove quiz">×</button>
            `;
            
            selectedContainer.appendChild(quizItem);
        });
    }

    updateTournamentInfo() {
        const totalQuestionsElement = document.getElementById('total-tournament-questions');
        const maxScoreElement = document.getElementById('max-tournament-score');
        
        if (!this.selectedTournamentQuizzes || this.selectedTournamentQuizzes.length === 0) {
            totalQuestionsElement.textContent = '0';
            maxScoreElement.textContent = '0';
            return;
        }
        
        const totalQuestions = this.selectedTournamentQuizzes.reduce((sum, quiz) => sum + quiz.questions.length, 0);
        const maxScore = totalQuestions * 100; // 100 points per question
        
        totalQuestionsElement.textContent = totalQuestions;
        maxScoreElement.textContent = maxScore;
    }

    updateCreateTournamentButton() {
        const createBtn = document.getElementById('create-tournament-btn');
        const hasQuizzes = this.selectedTournamentQuizzes && this.selectedTournamentQuizzes.length >= 2;
        
        createBtn.disabled = !hasQuizzes;
        
        if (hasQuizzes) {
            createBtn.innerHTML = `<i class="ph ph-trophy"></i> Create Tournament (${this.selectedTournamentQuizzes.length} quizzes)`;
        } else {
            createBtn.innerHTML = `<i class="ph ph-trophy"></i> Select at least 2 quizzes`;
        }
    }

    async handleCreateTournament(event) {
        event.preventDefault();
        
        const tournamentName = document.getElementById('tournament-name').value.trim();
        const creatorName = document.getElementById('tournament-creator').value.trim();
        
        if (!tournamentName || !creatorName) {
            this.showAlert('Please fill in all required fields');
            return;
        }
        
        if (!this.selectedTournamentQuizzes || this.selectedTournamentQuizzes.length < 2) {
            this.showAlert('Please select at least 2 quizzes for the tournament');
            return;
        }
        
        // Show loading state
        const createBtn = document.getElementById('create-tournament-btn');
        createBtn.disabled = true;
        createBtn.innerHTML = '<i class="ph ph-robot"></i> Creating Tournament...';
        
        this.showLoading('Creating Tournament...', 'Combining quizzes and setting up the match');
        
        try {
            // Create combined quiz from selected quizzes
            const combinedQuiz = this.createCombinedQuiz(tournamentName, creatorName);
            
            // Connect to WebSocket and create tournament session
            await this.connectWebSocket();
            
            const message = {
                type: 'create_tournament',
                tournament: {
                    name: tournamentName,
                    createdBy: creatorName,
                    quizzes: this.selectedTournamentQuizzes,
                    combinedQuiz: combinedQuiz
                },
                playerName: creatorName
            };
            
            this.sendMessage(message);
            
        } catch (error) {
            console.error('❌ Error creating tournament:', error);
            this.hideLoading();
            this.showAlert('Failed to create tournament. Please try again.');
            
            // Reset button state
            createBtn.disabled = false;
            createBtn.innerHTML = '<i class="ph ph-trophy"></i> Create Tournament';
        }
    }

    createCombinedQuiz(tournamentName, creatorName) {
        // Combine all questions from selected quizzes
        const allQuestions = [];
        
        this.selectedTournamentQuizzes.forEach(quiz => {
            quiz.questions.forEach(question => {
                allQuestions.push({
                    ...question,
                    sourceQuiz: quiz.title || quiz.topic
                });
            });
        });
        
        // Shuffle questions for variety
        const shuffledQuestions = this.shuffleArray([...allQuestions]);
        
        return {
            id: `tournament_${Date.now()}`,
            title: tournamentName,
            topic: `Tournament: ${this.selectedTournamentQuizzes.map(q => q.title || q.topic).join(', ')}`,
            questions: shuffledQuestions,
            createdBy: creatorName,
            createdAt: new Date(),
            isTournament: true,
            sourceQuizzes: this.selectedTournamentQuizzes.map(q => ({
                id: q.id,
                title: q.title || q.topic,
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
        return ErrorHandler.retry(async () => {
        return new Promise((resolve, reject) => {
            // Use PartyKit host for WebSocket connection
            const protocol = window.PARTYKIT_HOST.includes('localhost') ? 'ws:' : 'wss:';
            const host = window.PARTYKIT_HOST;
            const url = `${protocol}//${host}/party/${this.gameState.roomCode}`;
            
            console.log('🔌 Connecting to WebSocket:', url);
            console.log('🔌 Using host:', host);
            console.log('🔌 Using protocol:', protocol);
            
            if (this.socket) {
                console.log('🔌 Closing existing socket');
                this.socket.close();
            }
            
            this.socket = new WebSocket(url);
            
            // Set a connection timeout
            const connectionTimeout = setTimeout(() => {
                console.error('❌ WebSocket connection timeout');
                this.socket.close();
                    const error = new Error('Connection timeout');
                    error.type = 'websocket';
                    reject(error);
                }, 10000); // Increased timeout to 10 seconds
            
            this.socket.onopen = () => {
                console.log('✅ WebSocket connected to room:', this.gameState.roomCode);
                clearTimeout(connectionTimeout);
                resolve();
            };
            
            this.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📨 Received WebSocket message:', data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('❌ Error parsing WebSocket message:', error);
                        ErrorHandler.showUserError(error, 'Failed to process server message');
                }
            };
            
            this.socket.onclose = (event) => {
                console.log('🔌 WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
                clearTimeout(connectionTimeout);
                if (event.code !== 1000) { // Not a normal closure
                    this.showToast('Connection lost', 'error');
                        const error = new Error(`WebSocket closed unexpectedly: ${event.code} ${event.reason}`);
                        error.type = 'websocket';
                        reject(error);
                }
            };
            
            this.socket.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                clearTimeout(connectionTimeout);
                    const wsError = new Error('WebSocket connection failed');
                    wsError.type = 'websocket';
                    reject(wsError);
            };
        });
        }, 'WebSocket Connection', 2); // Only 2 retries for WebSocket
    }

    sendMessage(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(JSON.stringify(data));
                console.log('📤 Sent message:', data);
            } catch (error) {
                console.error('❌ Error sending message:', error);
                ErrorHandler.showUserError(error, 'Failed to send message to server');
                throw error; // Re-throw so retry logic can handle it
            }
        } else {
            console.error('❌ Cannot send message: WebSocket not connected. ReadyState:', this.socket?.readyState);
            console.error('❌ WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
            const error = new Error('WebSocket not connected');
            error.type = 'websocket';
            ErrorHandler.showUserError(error, 'Connection lost. Please try again.');
            throw error;
        }
    }

    handleMessage(data) {
        console.log('Received:', data);
        
        switch (data.type) {
            case 'quiz_created':
                this.handleQuizCreated(data);
                break;
            case 'tournament_created':
                this.handleTournamentCreated(data);
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
            case 'quiz_finished':
                this.handleQuizFinished(data);
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

    async handleTournamentCreated(data) {
        this.hideLoading();
        this.gameState.currentQuiz = data.quiz;
        this.gameState.currentSession = {
            id: data.sessionId,
            quiz: data.quiz,
            players: {},
            gameState: 'waiting',
            host: this.socket.id || 'host',
            isTournament: true,
            tournamentInfo: data.tournamentInfo
        };
        
        // Save tournament quiz to Firebase
        try {
            const quizId = await this.quizDatabase.saveQuiz(data.quiz);
            console.log('💾 Tournament quiz saved to Firebase with ID:', quizId);
            
            // Update the quiz ID in our session
            if (this.gameState.currentQuiz) {
                this.gameState.currentQuiz.id = quizId;
            }
            if (this.gameState.currentSession && this.gameState.currentSession.quiz) {
                this.gameState.currentSession.quiz.id = quizId;
            }
        } catch (error) {
            console.error('❌ Error saving tournament quiz to Firebase:', error);
            // Continue without Firebase - tournament will still work in memory
        }
        
        this.showToast('Tournament created successfully!', 'success');
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
                this.resetStartButton(); // Reset button state when transitioning to lobby
                this.updateLobbyDisplay();
                this.showScreen('lobby');
                return;
            }
        }
        
        // If session is in playing state and we're not in quiz screen, transition to quiz
        if (data.session.gameState === 'playing' && this.currentScreen !== 'quiz') {
            console.log('🎯 Session is playing but we\'re not in quiz screen - transitioning to quiz');
            this.handleSessionState(data);
            return;
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
            this.resetStartButton(); // Reset button state when showing lobby for first time
            this.updateLobbyDisplay();
            this.showScreen('lobby');
            return;
        }
        
        // Update current screen
        if (this.currentScreen === 'lobby') {
            this.updateLobbyDisplay();
        } else if (this.currentScreen === 'quiz') {
            this.updateQuizDisplay();
            this.updateLiveLeaderboard();
        }
    }

    handleSessionState(data) {
        console.log('🎮 handleSessionState() called with gameState:', data.session.gameState);
        this.gameState.currentSession = data.session;
        
        if (data.session.gameState === 'waiting') {
            console.log('⏳ Session state: waiting - showing lobby');
            this.hideLoading(); // Hide loading if we're back to waiting
            this.resetStartButton(); // Reset button state when returning to waiting
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
            this.resetStartButton(); // Reset button state when quiz starts
            
            // Set game start time when quiz begins
            if (!this.gameStartTime) {
                this.gameStartTime = Date.now();
            }
            
            this.updateQuizDisplay();
            this.showScreen('quiz');
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
        
        // Color code the answer options
        this.colorCodeAnswers(data.currentQuestion.correctAnswer);
        
        // Show inline results
        this.showInlineResults(data);
    }

    colorCodeAnswers(correctAnswerIndex) {
        const answerOptions = document.querySelectorAll('.answer-option');
        const selectedOption = document.querySelector('.answer-option.selected');
        
        answerOptions.forEach((option, index) => {
            // Remove existing color classes and inline styles
            option.classList.remove('correct', 'incorrect', 'neutral');
            option.style.backgroundColor = '';
            option.style.color = '';
            
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
            
            // Save highscores when quiz is finished (only once)
            if (!this.gameState.highscoresSaved) {
            this.saveHighscores(data.playerAnswers);
                this.gameState.highscoresSaved = true;
            }
            
            // Auto-show final results after a short delay for last question
            setTimeout(() => {
                this.handleQuizFinished(data);
            }, 3000);
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
        
        // Update live leaderboard with new scores
        this.updateLiveLeaderboard();
    }

    handleQuizFinished(data) {
        console.log('🏁 Quiz finished:', data);
        
        // Ensure highscores are saved (in case they weren't saved in showInlineResults)
        if (data.playerAnswers && Object.keys(data.playerAnswers).length > 0 && !this.gameState.highscoresSaved) {
            console.log('💾 Ensuring highscores are saved for quiz completion');
            this.saveHighscores(data.playerAnswers);
            this.gameState.highscoresSaved = true;
        }
        
        // Show final results screen first
        this.showScreen('final-results');
        
        // Show loading state initially with spinner
        const leaderboardElement = document.getElementById('final-leaderboard');
        if (leaderboardElement) {
            leaderboardElement.innerHTML = `
                <div class="loading-highscores">
                    <div class="loading-spinner"></div>
                    <div>Calculating final scores...</div>
                </div>
            `;
        }
        
        // Update final leaderboard with a more realistic delay for better UX
        setTimeout(() => {
            this.updateFinalLeaderboard(data.playerAnswers);
        }, 1500);
        
        // Note: All-time leaderboard functionality removed as the HTML element doesn't exist
        // TODO: Add all-time leaderboard section to HTML if needed
    }

    updateFinalLeaderboard(playerAnswers) {
        const leaderboardElement = document.getElementById('final-leaderboard');
        if (!leaderboardElement) return;
        
        console.log('📊 Updating final leaderboard with data:', playerAnswers);
        
        // Validate playerAnswers data
        if (!playerAnswers || Object.keys(playerAnswers).length === 0) {
            console.warn('⚠️ No player answers data available for leaderboard');
            leaderboardElement.innerHTML = `
                <div class="loading-highscores">
                    <div>No scores available</div>
                </div>
            `;
            return;
        }
        
        // Get the total number of questions to calculate percentage
        const session = this.gameState.currentSession;
        const totalQuestions = session?.quiz?.questions?.length || 1;
        
        // Convert player answers to sorted array
        const players = Object.entries(playerAnswers).map(([id, data]) => {
            // Calculate correct answers from score if not available directly
            let correctAnswers = data.correctAnswers || 0;
            
            // If correctAnswers is not available, estimate from score
            // Assuming each correct answer gives 100 points (you can adjust this)
            if (correctAnswers === 0 && data.score > 0) {
                correctAnswers = Math.floor(data.score / 100);
            }
            
            // Calculate percentage only if we have valid data
            let percentage = 0;
            if (totalQuestions > 0) {
                percentage = Math.round((correctAnswers / totalQuestions) * 100);
            }
            
            return {
            id,
            name: data.name,
                score: data.score || 0,
                percentage: percentage,
                correctAnswers: correctAnswers
            };
        });
        
        // Sort by score (highest first)
        players.sort((a, b) => b.score - a.score);
        
        console.log('📊 Sorted players for leaderboard:', players);
        
        // Create a temporary container to build the new content
        const tempContainer = document.createElement('div');
        tempContainer.className = 'leaderboard';
        
        // Create leaderboard items
        players.forEach((player, index) => {
            const scoreItem = document.createElement('div');
            scoreItem.className = 'score-item';
            
            // Add staggered animation delay
            scoreItem.style.animationDelay = `${index * 0.1}s`;
            
            // Add special styling for top 3
            if (index === 0) scoreItem.classList.add('first-place');
            else if (index === 1) scoreItem.classList.add('second-place');
            else if (index === 2) scoreItem.classList.add('third-place');
            
            // Check if this is the current player
            const currentPlayer = this.getCurrentPlayer();
            if (currentPlayer && player.name === currentPlayer.name) {
                scoreItem.classList.add('current-player');
            }
            
            scoreItem.innerHTML = `
                <div class="rank">${index + 1}</div>
                <div class="player-name">${player.name}${currentPlayer && player.name === currentPlayer.name ? ' (You)' : ''}</div>
                <div class="score">${player.score} pts${(player.percentage !== undefined && !isNaN(player.percentage)) ? ` (${player.percentage}%)` : ''}</div>
            `;
            
            tempContainer.appendChild(scoreItem);
        });
        
        // Replace the entire content at once to minimize visual disruption
        leaderboardElement.innerHTML = tempContainer.innerHTML;
        
        console.log('✅ Final leaderboard updated successfully');
    }

    async loadAllTimeLeaderboard() {
        const session = this.gameState.currentSession;
        if (!session || !session.quiz || !session.quiz.id) {
            console.log('⚠️ No quiz ID available for all-time leaderboard');
            return;
        }

        const allTimeElement = document.getElementById('all-time-leaderboard');
        if (!allTimeElement) return;

        try {
            // Show loading state
            allTimeElement.innerHTML = `
                <div class="loading-highscores">
                    <div class="loading-spinner"></div>
                    <div>Loading all-time scores...</div>
                </div>
            `;

            // Get highscores from Firebase
            const highscores = await this.quizDatabase.getHighscores(session.quiz.id, 10);
            
            if (highscores.length === 0) {
                allTimeElement.innerHTML = `
                    <div class="loading-highscores">
                        <div>No previous scores for this quiz</div>
                    </div>
                `;
                return;
            }

            // Clear loading and display scores
            allTimeElement.innerHTML = '';

            highscores.forEach((score, index) => {
                const scoreItem = document.createElement('div');
                scoreItem.className = 'score-item';
                
                // Add special styling for top 3
                if (index === 0) scoreItem.classList.add('first-place');
                else if (index === 1) scoreItem.classList.add('second-place');
                else if (index === 2) scoreItem.classList.add('third-place');
                
                // Check if this is the current player
                const currentPlayer = this.getCurrentPlayer();
                if (currentPlayer && score.playerName === currentPlayer.name) {
                    scoreItem.classList.add('current-player');
                }
                
                scoreItem.innerHTML = `
                    <div class="rank">${index + 1}</div>
                    <div class="player-name">${score.playerName}${currentPlayer && score.playerName === currentPlayer.name ? ' (You)' : ''}</div>
                    <div class="score">${score.score} pts${score.percentage !== undefined ? ` (${score.percentage}%)` : ''}</div>
                `;
                
                allTimeElement.appendChild(scoreItem);
            });

        } catch (error) {
            console.error('❌ Error loading all-time leaderboard:', error);
            allTimeElement.innerHTML = `
                <div class="loading-highscores">
                    <div>Failed to load all-time scores</div>
                </div>
            `;
        }
    }

    async viewAllTimeHighscores() {
        const session = this.gameState.currentSession;
        if (!session || !session.quiz || !session.quiz.id) {
            this.showAlert('No quiz data available for highscores');
            return;
        }

        try {
            const highscores = await this.quizDatabase.getHighscores(session.quiz.id, 50); // Get more scores for the modal
            this.showHighscoresModal(session.quiz.topic, highscores);
        } catch (error) {
            console.error('❌ Error loading highscores:', error);
            this.showAlert('Failed to load highscores. Please try again.');
        }
    }

    handleQuizStarted(data) {
        console.log('🚀 Quiz started:', data);
        
        // Clear timeout and hide loading when quiz starts
        if (this.startQuizTimeout) {
            clearTimeout(this.startQuizTimeout);
            this.startQuizTimeout = null;
        }
        this.hideLoading();
        this.resetStartButton(); // Reset button state when quiz starts
        
        // Update session with the started quiz data
        this.gameState.currentSession = data.session;
        
        // Reset highscores saved flag for new quiz
        this.gameState.highscoresSaved = false;
        
        // Set game start time when quiz begins
        if (!this.gameStartTime) {
            this.gameStartTime = Date.now();
        }
        
        this.updateQuizDisplay();
        this.showScreen('quiz');
    }

    updateLobbyDisplay() {
        const session = this.gameState.currentSession;
        if (!session) return;
        
        // Update quiz info
        if (session.isTournament) {
            document.getElementById('quiz-title-display').innerHTML = `<i class="ph ph-trophy"></i> ${session.quiz.title || 'Tournament'}`;
            document.getElementById('quiz-topic-display').textContent = session.quiz.topic || 'Mixed Tournament';
            document.getElementById('quiz-question-count').textContent = `${session.quiz.questions.length} (from ${session.tournamentInfo?.sourceQuizzes?.length || 0} quizzes)`;
            document.getElementById('quiz-creator').textContent = session.quiz.createdBy || 'Tournament Host';
        } else {
            document.getElementById('quiz-title-display').textContent = session.quiz.title || session.quiz.topic;
            document.getElementById('quiz-topic-display').textContent = session.quiz.topic;
            document.getElementById('quiz-question-count').textContent = session.quiz.questions.length;
            document.getElementById('quiz-creator').textContent = session.quiz.createdBy;
        }
        document.getElementById('room-code-display').textContent = this.gameState.roomCode;
        
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
        
        // Update live leaderboard
        this.updateLiveLeaderboard();
    }

    updateLiveLeaderboard() {
        const session = this.gameState.currentSession;
        if (!session || !session.players) {
            return;
        }
        
        const leaderboardContainer = document.getElementById('live-leaderboard-list');
        if (!leaderboardContainer) {
            return;
        }
        
        // Convert players object to array and sort by score
        const players = Object.values(session.players).sort((a, b) => b.score - a.score);
        
        // Clear existing leaderboard
        leaderboardContainer.innerHTML = '';
        
        // Add each player to the leaderboard
        players.forEach((player, index) => {
            const scoreItem = document.createElement('div');
            scoreItem.className = 'live-score-item';
            
            // Add special classes for ranking and current player
            if (index === 0) scoreItem.classList.add('first-place');
            else if (index === 1) scoreItem.classList.add('second-place');
            else if (index === 2) scoreItem.classList.add('third-place');
            
            if (player.name === this.gameState.playerName) {
                scoreItem.classList.add('current-player');
            }
            
            scoreItem.innerHTML = `
                <span class="live-score-rank">${index + 1}</span>
                <span class="live-score-name">${player.name}</span>
                <span class="live-score-points">${player.score}</span>
            `;
            
            leaderboardContainer.appendChild(scoreItem);
        });
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
                // Immediately show visual feedback for selection
                selectedOption.style.backgroundColor = 'var(--accent-color)';
                selectedOption.style.color = 'white';
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

    // Timer functionality removed - unlimited time per answer

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

    resetStartButton() {
        const startBtn = document.getElementById('start-quiz-btn');
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.textContent = 'Start Quiz'; // Reset to default text
            console.log('🔄 Start button reset');
        }
    }

    verifyModalElements() {
        const requiredModals = [
            'alert-modal',
            'confirm-modal', 
            'prompt-modal'
        ];
        
        const requiredElements = [
            'alert-message',
            'alert-ok-btn',
            'confirm-message',
            'confirm-cancel-btn',
            'confirm-ok-btn',
            'prompt-message',
            'prompt-input',
            'prompt-cancel-btn',
            'prompt-ok-btn'
        ];
        
        let allElementsFound = true;
        
        // Check modal containers
        requiredModals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (!modal) {
                console.error(`❌ Missing modal element: ${modalId}`);
                allElementsFound = false;
            }
        });
        
        // Check modal sub-elements
        requiredElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (!element) {
                console.error(`❌ Missing modal sub-element: ${elementId}`);
                allElementsFound = false;
            }
        });
        
        if (allElementsFound) {
            console.log('✅ All modal elements verified successfully');
        } else {
            console.warn('⚠️ Some modal elements are missing - will fallback to browser dialogs');
        }
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
        if (!this.gameState.currentSession || !this.gameStartTime) {
            console.log('⚠️ Cannot save highscores: missing session or start time');
            return;
        }
        
        try {
            const session = this.gameState.currentSession;
            const totalQuestions = session.quiz.questions.length;
            const gameEndTime = Date.now();
            const totalTimeSpent = Math.round((gameEndTime - this.gameStartTime) / 1000);
            const playerCount = Object.keys(playerAnswers).length;
            
            console.log(`💾 Saving highscores for ${playerCount} players in quiz: ${session.quiz.id}`);
            console.log(`📊 Quiz details: ${totalQuestions} questions, ${totalTimeSpent}s duration`);
            
            // Save highscore for each player
            for (const [playerId, playerData] of Object.entries(playerAnswers)) {
                console.log(`💾 Saving score for ${playerData.name}: ${playerData.score} points`);
                
                await this.quizDatabase.saveHighscore(
                    session.quiz.id,
                    playerData.name,
                    playerData.score,
                    totalQuestions,
                    totalTimeSpent
                );
            }
            
            // Update session statistics to track total players who played this session
            await this.updateSessionStats(session.quiz.id, playerCount);
            
            console.log(`✅ Highscores saved successfully for ${playerCount} players`);
        } catch (error) {
            console.error('❌ Error saving highscores:', error);
        }
    }

    async updateSessionStats(quizId, playerCount) {
        try {
            // Track session-level statistics
            const sessionStatsRef = ref(this.quizDatabase.db, `sessionStats/${quizId}`);
            const sessionRef = push(sessionStatsRef);
            
            const sessionData = {
                playerCount: playerCount,
                timestamp: Date.now(),
                sessionId: this.gameState.roomCode
            };
            
            await set(sessionRef, sessionData);
            console.log(`📊 Session stats saved: ${playerCount} players in session ${this.gameState.roomCode}`);
        } catch (error) {
            console.error('❌ Error saving session stats:', error);
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
            
            // Reset the start button
            this.resetStartButton();
            this.updateLobbyDisplay(); // This will restore the proper button text
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
                        <span><i class="ph ph-note"></i></span>
                        <span>${quiz.questions.length} questions</span>
                    </div>
                    <div class="quiz-stat">
                        <span><i class="ph ph-game-controller"></i></span>
                        <span>${quiz.playCount || 0} plays</span>
                    </div>
                    <div class="quiz-stat">
                        <span><i class="ph ph-calendar"></i></span>
                        <span>${createdDate}</span>
                    </div>
                    ${quiz.language ? `
                        <div class="quiz-stat">
                            <span><i class="ph ph-translate"></i></span>
                            <span>${this.getLanguageDisplay(quiz.language)}</span>
                        </div>
                    ` : ''}
                    ${quiz.averageScore ? `
                        <div class="quiz-stat">
                            <span><i class="ph ph-star"></i></span>
                            <span>${quiz.averageScore}% avg</span>
                        </div>
                    ` : ''}
                </div>
                <div class="quiz-item-actions">
                    <button class="btn btn-primary" onclick="window.quizGame.playQuiz('${quiz.id}')">Play Quiz</button>
                                            <button class="btn btn-outline" onclick="window.quizGame.viewHighscores('${quiz.id}', '${quiz.title || quiz.topic}')">View Highscores</button>
                </div>
            `;
            
            quizList.appendChild(quizItem);
        });
    }

    getLanguageDisplay(languageCode) {
        const languageMap = {
            'en': '🇺🇸 English',
            'es': '🇪🇸 Español',
            'fr': '🇫🇷 Français',
            'de': '🇩🇪 Deutsch',
            'it': '🇮🇹 Italiano',
            'nl': '🇳🇱 Nederlands',
            'pt': '🇵🇹 Português',
            'ja': '🇯🇵 日本語',
            'ko': '🇰🇷 한국어',
            'zh': '🇨🇳 中文',
            'ru': '🇷🇺 Русский',
            'ar': '🇸🇦 العربية',
            'hi': '🇮🇳 हिन्दी'
        };
        
        return languageMap[languageCode] || `🌐 ${languageCode}`;
    }

    async playQuiz(quizId) {
        try {
            console.log('🎮 Playing quiz:', quizId);
            
            // Show loading
            this.showLoading('Loading quiz...', 'Preparing your quiz experience...');
            
            const quiz = await this.quizDatabase.getQuiz(quizId);
            console.log('📚 Quiz loaded from database:', quiz);
            
            if (!quiz) {
                this.hideLoading();
                this.showToast('Quiz not found. Please try again.', 'error');
                return;
            }
            
            // Get player name
            console.log('🎯 Prompting for player name...');
            
            // Temporarily hide loading to show prompt
            this.hideLoading();
            
            const playerName = await this.showPrompt('Enter your name:', 'Player Name');
            console.log('🎯 Player name received:', playerName);
            
            // Show loading again
            if (playerName) {
                this.showLoading('Connecting to quiz...', 'Setting up your game session...');
            }
            
            if (!playerName) {
                console.log('🎯 No player name provided, hiding loading');
                this.hideLoading();
                return;
            }
            
            // Generate room code and connect
            this.gameState.roomCode = this.generateRoomCode();
            this.gameState.playerName = playerName.trim();
            this.gameState.isHost = true;
            
            console.log('🔌 Connecting to WebSocket with room code:', this.gameState.roomCode);
            
            try {
                await this.connectWebSocket();
                console.log('✅ WebSocket connected successfully');
            } catch (wsError) {
                console.error('❌ WebSocket connection failed:', wsError);
                this.hideLoading();
                this.showToast('Failed to connect to server. Please try again.', 'error');
                return;
            }
            
            // Send message to create session with existing quiz
            console.log('📤 Sending play_existing_quiz message...');
            const message = {
                type: 'play_existing_quiz',
                quizId: quizId,
                quiz: quiz, // Send the full quiz data
                playerName: this.gameState.playerName
            };
            
            console.log('📤 Message to send:', message);
            this.sendMessage(message);
            
            // Set timeout for loading
            if (this.playQuizTimeout) {
                clearTimeout(this.playQuizTimeout);
            }
            
            this.playQuizTimeout = setTimeout(() => {
                console.log('⏰ Play quiz timeout - attempting fallback');
                
                // Try fallback: create session locally
                try {
                    this.gameState.currentQuiz = quiz;
                    this.gameState.currentSession = {
                        id: this.gameState.roomCode,
                        quiz: quiz,
                        players: {
                            [this.gameState.playerName]: {
                                id: this.gameState.playerName,
                                name: this.gameState.playerName,
                                score: 0,
                                hasAnswered: false,
                                isReady: false,
                                isHost: true
                            }
                        },
                        gameState: 'waiting',
                        host: this.gameState.playerName
                    };
                    
                    console.log('✅ Fallback: Created local session');
                    this.hideLoading();
                    this.showToast('Quiz loaded in offline mode', 'info');
                    this.updateLobbyDisplay();
                    this.showScreen('lobby');
                } catch (fallbackError) {
                    console.error('❌ Fallback failed:', fallbackError);
                    this.hideLoading();
                    this.showToast('Quiz loading failed. Please try again.', 'error');
                }
            }, 8000); // 8 second timeout before fallback
            
        } catch (error) {
            console.error('❌ Error playing quiz:', error);
            this.hideLoading();
            this.showToast('Error loading quiz. Please try again.', 'error');
        }
    }

    async viewHighscores(quizId, quizTitle) {
        try {
            const highscores = await this.quizDatabase.getHighscores(quizId);
            this.showHighscoresModal(quizTitle, highscores);
        } catch (error) {
            console.error('Error loading highscores:', error);
            this.showToast('Error loading highscores.', 'error');
        }
    }

    showHighscoresModal(quizTitle, highscores) {
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'highscores-modal';
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.closeHighscoresModal(modal);
            }
        };
        
        modal.innerHTML = `
            <div class="highscores-content">
                <div class="highscores-header">
                    <h3>Highscores: ${quizTitle}</h3>
                    <button class="close-btn" onclick="window.quizGame.closeHighscoresModal(this.closest('.highscores-modal'))">×</button>
                </div>
                <ul class="highscore-list">
                    ${highscores.length === 0 ? '<li class="highscore-item">No scores yet. Be the first to play!</li>' : 
                        highscores.map((score, index) => `
                            <li class="highscore-item">
                                <span class="highscore-rank">#${index + 1}</span>
                                <span class="highscore-name">${score.playerName}</span>
                                <span class="highscore-score">
                                    ${score.score} pts${score.percentage !== undefined ? ` (${score.percentage}%)` : ''}
                                </span>
                            </li>
                        `).join('')
                    }
                </ul>
            </div>
        `;
        
        // Add keyboard escape support
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                this.closeHighscoresModal(modal);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Store the escape handler for cleanup
        modal._escapeHandler = handleEscape;
        
        document.body.appendChild(modal);
        
        // Focus the modal for better accessibility
        setTimeout(() => {
            modal.focus();
        }, 100);
    }

    closeHighscoresModal(modal) {
        if (modal && modal.parentNode) {
            // Clean up escape handler
            if (modal._escapeHandler) {
                document.removeEventListener('keydown', modal._escapeHandler);
            }
            document.body.removeChild(modal);
        }
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
            
            // Check if modal elements exist
            if (!modal || !messageEl) {
                console.error('❌ Alert modal elements not found, falling back to browser alert');
                alert(`${title}: ${message}`);
                resolve();
                return;
            }
            
            const titleEl = modal.querySelector('.modal-title');
            const okBtn = document.getElementById('alert-ok-btn');
            
            if (!titleEl || !okBtn) {
                console.error('❌ Alert modal sub-elements not found, falling back to browser alert');
                alert(`${title}: ${message}`);
                resolve();
                return;
            }
            
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
            
            // Check if modal elements exist
            if (!modal || !messageEl) {
                console.error('❌ Confirm modal elements not found, falling back to browser confirm');
                const result = confirm(`${title}: ${message}`);
                resolve(result);
                return;
            }
            
            const titleEl = modal.querySelector('.modal-title');
            const cancelBtn = document.getElementById('confirm-cancel-btn');
            const confirmBtn = document.getElementById('confirm-ok-btn');
            
            if (!titleEl || !cancelBtn || !confirmBtn) {
                console.error('❌ Confirm modal sub-elements not found, falling back to browser confirm');
                const result = confirm(`${title}: ${message}`);
                resolve(result);
                return;
            }
            
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
            
            // Check if modal elements exist
            if (!modal || !messageEl) {
                console.error('❌ Prompt modal elements not found, falling back to browser prompt');
                const result = prompt(`${title}: ${message}`, '');
                resolve(result);
                return;
            }
            
            const titleEl = modal.querySelector('.modal-title');
            const inputEl = document.getElementById('prompt-input');
            const cancelBtn = document.getElementById('prompt-cancel-btn');
            const okBtn = document.getElementById('prompt-ok-btn');
            
            if (!titleEl || !inputEl || !cancelBtn || !okBtn) {
                console.error('❌ Prompt modal sub-elements not found, falling back to browser prompt');
                const result = prompt(`${title}: ${message}`, '');
                resolve(result);
                return;
            }
            
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
window.addEventListener('DOMContentLoaded', async () => {
    window.quizGame = new QuizGameClient();
    await window.quizGame.init();
}); 

// Content Moderation for Client-side
class ClientContentModerator {
    static BLOCKED_KEYWORDS = [
        // Hate speech and discrimination
        'racist', 'racism', 'nazi', 'hitler', 'supremacist', 'genocide',
        'sexist', 'misogyn', 'homophob', 'transphob', 'terrorist',
        
        // Explicit sexual content
        'hardcore sex', 'nude photos', 'naked pics', 'erotic images', 'fetish porn', 'bdsm porn',
        
        // Instructions for illegal activities
        'how to murder', 'how to kill', 'murder methods', 'assassination',
        'how to make drugs', 'drug manufacturing', 'cocaine production', 'heroin production',
        'how to make weapons', 'bomb instructions', 'explosive instructions',
        'how to hack', 'illegal hacking', 'credit card fraud', 'identity theft',
        
        // Personal attacks
        'doxx', 'harassment', 'stalking', 'threaten', 'cyberbully', 'death threat'
    ];

    static FLAGGED_KEYWORDS = [
        'controversial', 'political party', 'sensitive topic', 'adult content'
    ];

    static POSITIVE_KEYWORDS = [
        'history', 'historical', 'educational', 'science', 'biology', 'academic', 'learning',
        'geography', 'literature', 'movies', 'entertainment', 'sports', 'music', 'bands', 'artists',
        'food', 'travel', 'technology', 'nature', 'animals', 'medicine', 'healthcare',
        'religion', 'religious', 'mythology', 'cultural', 'tradition', 'festival',
        'alcohol', 'beer', 'wine', 'spirits', 'brewing', 'cocktails', 'bartending',
        'quiz', 'trivia', 'knowledge', 'facts', 'general knowledge', 'cooking', 'culinary'
    ];

    static validateTopic(topic, title = '') {
        const fullText = `${topic} ${title}`.toLowerCase().trim();
        
        // Check for blocked content (truly illegal or harmful)
        for (const keyword of this.BLOCKED_KEYWORDS) {
            if (fullText.includes(keyword.toLowerCase())) {
                return {
                    isValid: false,
                    severity: 'high',
                    message: 'This topic contains content that violates our community guidelines.',
                    suggestion: 'Try topics like science, history, entertainment, sports, or general knowledge.'
                };
            }
        }
        
        // Check for flagged content (potentially sensitive but often legitimate)
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
                    message: 'This topic may be sensitive. Consider adding educational context.',
                    suggestion: 'Try adding educational context like "History of..." or "Science of..." to make the topic more appropriate.'
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
            'Famous Inventions',
            'Beer and Brewing History',
            'Wine Regions of the World',
            'Cocktail Recipes and Bartending',
            'World Religions and Mythology',
            'Medical Breakthroughs and Healthcare'
        ];
    }

    static getContentGuidelines() {
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