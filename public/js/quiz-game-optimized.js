// Optimized QuizWorld - Main Application with Dynamic Imports
import { ref, push, set, get, query, orderByChild, limitToLast, update } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// Performance monitoring
const performanceStart = performance.now();

// Global state and utilities (keep these minimal for initial load)
class QuizApp {
    constructor() {
        this.modules = {};
        this.gameState = {
            roomCode: null,
            playerName: null,
            isHost: false,
            currentQuestion: 0,
            answers: {},
            score: 0,
            players: [],
            quiz: null,
            sessionId: null
        };
        this.currentScreen = 'welcome';
        this.navigationStack = ['welcome'];
        this.isNavigatingBack = false;
        this.websocket = null;
        this.quizDatabase = null;
    }

    // Lazy load modules only when needed
    async loadModule(moduleName) {
        if (this.modules[moduleName]) {
            return this.modules[moduleName];
        }

        console.log(`📦 Loading module: ${moduleName}`);
        
        try {
            switch (moduleName) {
                case 'errorHandler':
                    const { ErrorHandler } = await import('./modules/error-handler.js');
                    this.modules[moduleName] = ErrorHandler;
                    break;
                    
                case 'contentModerator':
                    const { ClientContentModerator } = await import('./modules/content-moderator.js');
                    this.modules[moduleName] = ClientContentModerator;
                    break;
                    
                default:
                    throw new Error(`Unknown module: ${moduleName}`);
            }
            
            console.log(`✅ Module loaded: ${moduleName}`);
            return this.modules[moduleName];
        } catch (error) {
            console.error(`❌ Failed to load module ${moduleName}:`, error);
            throw error;
        }
    }

    // Optimized initialization - only load essential features first
    async init() {
        console.log('🚀 QuizWorld starting...');
        
        // Initialize core features immediately
        this.initializeQuizDatabase();
        this.setupEventListeners();
        this.initializeBrowserHistory();
        
        // Setup form validation (loads content moderator on demand)
        this.setupCreateQuizValidation();
        
        // Handle URL parameters
        this.handleURLParameters();
        
        console.log(`⚡ QuizWorld initialized in ${(performance.now() - performanceStart).toFixed(2)}ms`);
    }

    initializeQuizDatabase() {
        // Lightweight database wrapper
        this.quizDatabase = {
            db: window.firebaseDatabase,
            isReady: window.firebaseReady || false,
            
            async waitForFirebase() {
                if (this.isReady && this.db) return true;
                
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
        };
    }

    setupEventListeners() {
        // Critical event listeners only
        document.getElementById('create-quiz-option')?.addEventListener('click', () => this.showScreen('create-quiz'));
        document.getElementById('join-quiz-option')?.addEventListener('click', () => this.showScreen('join-session'));
        document.getElementById('browse-quizzes-option')?.addEventListener('click', () => this.showBrowseQuizzes());
        document.getElementById('create-tournament-option')?.addEventListener('click', () => this.showCreateTournament());
        
        // Form handlers
        document.getElementById('create-quiz-form')?.addEventListener('submit', (e) => this.handleCreateQuiz(e));
        document.getElementById('join-session-form')?.addEventListener('submit', (e) => this.handleJoinSession(e));
        
        // Back buttons
        document.getElementById('back-to-welcome')?.addEventListener('click', () => this.showScreen('welcome'));
        document.getElementById('back-to-welcome-2')?.addEventListener('click', () => this.showScreen('welcome'));
    }

    async setupCreateQuizValidation() {
        const titleField = document.getElementById('quiz-title');
        const topicField = document.getElementById('quiz-topic');
        const creatorField = document.getElementById('creator-name');
        const questionCountSelect = document.getElementById('question-count');
        const submitBtn = document.getElementById('generate-quiz-btn');
        
        if (!titleField || !topicField || !creatorField || !submitBtn) return;

        // Initially disable the button
        submitBtn.disabled = true;
        
        // Force white text on initially disabled button
        const btnText = submitBtn.querySelector('.btn-text');
        if (btnText) {
            btnText.style.color = 'white';
            btnText.style.setProperty('color', 'white', 'important');
        }
        submitBtn.style.color = 'white';
        submitBtn.style.setProperty('color', 'white', 'important');

        const validateForm = async () => {
            const allFieldsFilled = [titleField, topicField, creatorField].every(field => field.value.trim());
            
            let contentValid = true;
            
            if (topicField.value.trim()) {
                // Lazy load content moderator only when needed
                const ContentModerator = await this.loadModule('contentModerator');
                const moderation = ContentModerator.validateTopic(topicField.value.trim(), titleField.value.trim());
                contentValid = moderation.isValid;
                
                if (!contentValid) {
                    this.showContentValidationFeedback(moderation);
                } else {
                    this.hideContentValidationFeedback();
                }
            }
            
            submitBtn.disabled = !(allFieldsFilled && contentValid);
            
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
        };

        // Debounced validation for better performance
        let validationTimeout;
        const debouncedValidate = () => {
            clearTimeout(validationTimeout);
            validationTimeout = setTimeout(validateForm, 300);
        };

        [titleField, topicField, creatorField].forEach(field => {
            field.addEventListener('input', debouncedValidate);
            field.addEventListener('blur', validateForm);
        });

        questionCountSelect?.addEventListener('change', validateForm);
    }

    showContentValidationFeedback(moderation) {
        let feedbackDiv = document.getElementById('content-validation-feedback');
        if (!feedbackDiv) {
            feedbackDiv = document.createElement('div');
            feedbackDiv.id = 'content-validation-feedback';
            feedbackDiv.style.cssText = `
                margin-top: 8px; padding: 8px 12px; border-radius: 6px; font-size: 14px;
                display: none; transition: all 0.3s ease;
            `;
            document.getElementById('quiz-topic').parentNode.insertBefore(
                feedbackDiv, 
                document.getElementById('quiz-topic').nextSibling
            );
        }
        
        feedbackDiv.style.display = 'block';
        feedbackDiv.style.background = moderation.severity === 'high' ? '#f8d7da' : '#fff3cd';
        feedbackDiv.style.border = moderation.severity === 'high' ? '1px solid #f5c6cb' : '1px solid #ffeaa7';
        feedbackDiv.style.color = moderation.severity === 'high' ? '#721c24' : '#856404';
        feedbackDiv.innerHTML = `
            ${moderation.severity === 'high' ? '❌' : '⚠️'} ${moderation.message}
            ${moderation.suggestion ? `<br><strong>Suggestion:</strong> ${moderation.suggestion}` : ''}
        `;
    }

    hideContentValidationFeedback() {
        const feedbackDiv = document.getElementById('content-validation-feedback');
        if (feedbackDiv) {
            feedbackDiv.style.display = 'none';
        }
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

        // Load error handler for retry logic
        const ErrorHandler = await this.loadModule('errorHandler');
        const ContentModerator = await this.loadModule('contentModerator');
        
        // Final validation
        const moderation = ContentModerator.validateTopic(topic, title);
        if (!moderation.isValid) {
            this.showAlert(`${moderation.message}\n\n${moderation.suggestion || 'Please choose a different topic.'}`);
            return;
        }
        
        this.showLoading('Generating your quiz...', 'AI is creating questions based on your topic');
        
        this.gameState.roomCode = this.generateRoomCode();
        this.gameState.playerName = creatorName;
        this.gameState.isHost = true;
        
        try {
            await ErrorHandler.retry(async () => {
                await this.connectWebSocket();
                this.sendMessage({
                    type: 'create_quiz',
                    title,
                    topic,
                    questionCount,
                    playerName: creatorName
                });
            }, 'Create Quiz');
        } catch (error) {
            this.hideLoading();
            ErrorHandler.showUserError(error, 'Failed to create quiz. Please try again.');
        }
    }

    // Essential utility methods (keep these lightweight)
    showScreen(screenName) {
        document.querySelectorAll('.game-screen').forEach(screen => {
            screen.classList.remove('active');
            screen.classList.add('hidden');
        });
        
        const targetScreen = document.getElementById(screenName + '-screen');
        if (targetScreen) {
            targetScreen.classList.add('active');
            targetScreen.classList.remove('hidden');
            this.currentScreen = screenName;
        }
    }

    showToast(message, type = 'info') {
        // Lightweight toast implementation
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px; padding: 12px 20px;
            background: ${type === 'error' ? '#ff4444' : '#28a745'}; color: white;
            border-radius: 6px; z-index: 10000; opacity: 0; transition: opacity 0.3s;
        `;
        
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    showAlert(message) {
        // Simple alert for now, can be enhanced later
        alert(message);
    }

    showLoading(message, submessage = '') {
        // Minimal loading overlay
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <h3 id="loading-message">${message}</h3>
                    <p id="loading-submessage">${submessage}</p>
                </div>
            `;
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.8); z-index: 9999; display: flex;
                align-items: center; justify-content: center; color: white;
            `;
            document.body.appendChild(overlay);
        } else {
            document.getElementById('loading-message').textContent = message;
            document.getElementById('loading-submessage').textContent = submessage;
            overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    generateRoomCode() {
        return Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    // Placeholder methods - implement with lazy loading when needed
    async connectWebSocket() {
        // Implementation would be loaded dynamically
        console.log('WebSocket connection would be established here');
    }

    sendMessage(data) {
        // Implementation would be loaded dynamically
        console.log('Message would be sent:', data);
    }

    initializeBrowserHistory() {
        // Minimal history handling
        window.addEventListener('popstate', (event) => {
            if (event.state?.screen) {
                this.showScreen(event.state.screen);
            }
        });
    }

    handleURLParameters() {
        const params = new URLSearchParams(window.location.search);
        const screen = params.get('screen');
        const room = params.get('room');
        
        if (screen && ['create-quiz', 'join-session', 'browse-quizzes'].includes(screen)) {
            this.showScreen(screen);
        }
        
        if (room) {
            this.gameState.roomCode = room;
            this.showScreen('join-session');
            const roomCodeInput = document.getElementById('room-code');
            if (roomCodeInput) roomCodeInput.value = room;
        }
    }

    // Async method loaders for features used later
    async showBrowseQuizzes() {
        console.log('Browse quizzes feature would be loaded here');
        this.showScreen('browse-quizzes');
    }

    async showCreateTournament() {
        console.log('Tournament feature would be loaded here');
        this.showScreen('create-tournament');
    }

    async handleJoinSession(event) {
        event.preventDefault();
        console.log('Join session would be handled here');
    }
}

// Initialize the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        window.quizGame = new QuizApp();
        await window.quizGame.init();
    });
} else {
    window.quizGame = new QuizApp();
    await window.quizGame.init();
} 