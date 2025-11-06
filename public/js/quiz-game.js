// Import Firebase functions
import { ref, push, set, get, query, orderByChild, limitToLast, update } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const HEX_COLOR_REGEX = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

function sanitizeHexColor(value) {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!trimmed.startsWith('#')) return undefined;
    if (!HEX_COLOR_REGEX.test(trimmed)) return undefined;
    if (trimmed.length === 4) {
        return '#' + trimmed.slice(1).split('').map(ch => ch + ch).join('').toUpperCase();
    }
    return trimmed.toUpperCase();
}

function hexToRgba(hex, alpha = 1) {
    const sanitized = sanitizeHexColor(hex);
    if (!sanitized) return hex;
    const value = sanitized.slice(1);
    const bigint = parseInt(value, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function colorWithAlpha(color, alpha, fallback) {
    if (!color) return fallback;
    if (typeof color === 'string') {
        const trimmed = color.trim();
        if (!trimmed) return fallback;
        if (trimmed.startsWith('rgba') || trimmed.startsWith('rgb') || trimmed.startsWith('hsla')) {
            return trimmed;
        }
        const sanitized = sanitizeHexColor(trimmed);
        if (sanitized) {
            return hexToRgba(sanitized, alpha);
        }
        return trimmed;
    }
    return fallback;
}

const MIN_TEXT_CONTRAST = 4.5;

function clampColorComponent(value) {
    if (Number.isNaN(value)) return 0;
    return Math.min(255, Math.max(0, value));
}

function parseCssColor(color) {
    if (!color || typeof color !== 'string') return null;
    const trimmed = color.trim();
    if (!trimmed) return null;

    const hex = sanitizeHexColor(trimmed);
    if (hex) {
        const value = hex.slice(1);
        return {
            r: parseInt(value.slice(0, 2), 16),
            g: parseInt(value.slice(2, 4), 16),
            b: parseInt(value.slice(4, 6), 16)
        };
    }

    const rgbaMatch = trimmed.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (rgbaMatch) {
        return {
            r: clampColorComponent(parseFloat(rgbaMatch[1])),
            g: clampColorComponent(parseFloat(rgbaMatch[2])),
            b: clampColorComponent(parseFloat(rgbaMatch[3]))
        };
    }

    return null;
}

function relativeLuminance(rgb) {
    if (!rgb) return 0;
    const toLinear = (component) => {
        const channel = component / 255;
        return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    };
    const r = toLinear(rgb.r);
    const g = toLinear(rgb.g);
    const b = toLinear(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(colorA, colorB) {
    const lumA = relativeLuminance(colorA);
    const lumB = relativeLuminance(colorB);
    const [lighter, darker] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
    return (lighter + 0.05) / (darker + 0.05);
}

function ensureAccessibleTextColor(preferred, backgrounds, fallback) {
    const backgroundColors = (Array.isArray(backgrounds) ? backgrounds : [backgrounds])
        .map((color) => parseCssColor(color))
        .filter(Boolean);

    if (!backgroundColors.length) {
        const normalizedPreferred = sanitizeHexColor(preferred);
        if (normalizedPreferred) return normalizedPreferred;
        return preferred || fallback || '#000000';
    }

    const evaluateCandidate = (color) => {
        if (!color) return null;
        const parsed = parseCssColor(color);
        if (!parsed) return null;
        const minContrast = backgroundColors
            .map((bg) => contrastRatio(parsed, bg))
            .reduce((min, ratio) => Math.min(min, ratio), Infinity);
        return { color, minContrast };
    };

    const candidateConfigs = [];
    if (preferred) candidateConfigs.push({ color: preferred, prioritize: true });
    if (fallback && fallback !== preferred) candidateConfigs.push({ color: fallback });
    candidateConfigs.push({ color: '#FFFFFF' });
    candidateConfigs.push({ color: '#000000' });

    let bestCandidate = null;

    for (const config of candidateConfigs) {
        const evaluation = evaluateCandidate(config.color);
        if (!evaluation) continue;

        if (config.prioritize && evaluation.minContrast >= MIN_TEXT_CONTRAST) {
            const normalized = sanitizeHexColor(config.color);
            return normalized || config.color;
        }

        if (!bestCandidate || evaluation.minContrast > bestCandidate.minContrast) {
            bestCandidate = { ...evaluation, prioritized: !!config.prioritize };
        }
    }

    if (bestCandidate) {
        const normalized = sanitizeHexColor(bestCandidate.color);
        if (bestCandidate.minContrast >= MIN_TEXT_CONTRAST) {
            return normalized || bestCandidate.color;
        }
        return normalized || bestCandidate.color;
    }

    const normalizedFallback = sanitizeHexColor(fallback);
    if (normalizedFallback) return normalizedFallback;
    return fallback || '#000000';
}

function rgbToHex(rgb) {
    if (!rgb) return undefined;
    const toHex = (value) => {
        const clamped = clampColorComponent(Math.round(value));
        return clamped.toString(16).padStart(2, '0');
    };
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();
}

function mixRgb(base, target, amount) {
    const clampAmount = Math.min(1, Math.max(0, amount));
    return {
        r: clampColorComponent(base.r + (target.r - base.r) * clampAmount),
        g: clampColorComponent(base.g + (target.g - base.g) * clampAmount),
        b: clampColorComponent(base.b + (target.b - base.b) * clampAmount)
    };
}

function ensureSurfaceContrast(surfaceColor, textColor, fallbackSurface) {
    const surfaceRgb = parseCssColor(surfaceColor) || parseCssColor(fallbackSurface);
    const textRgb = parseCssColor(textColor) || parseCssColor('#FFFFFF');

    if (!surfaceRgb || !textRgb) {
        return surfaceColor || fallbackSurface;
    }

    const targetContrast = MIN_TEXT_CONTRAST;
    let adjusted = { ...surfaceRgb };
    let contrast = contrastRatio(adjusted, textRgb);

    if (contrast >= targetContrast) {
        return sanitizeHexColor(rgbToHex(adjusted)) || surfaceColor || fallbackSurface;
    }

    const textIsLight = relativeLuminance(textRgb) > relativeLuminance(adjusted);
    const target = textIsLight ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };

    for (let i = 0; i < 12 && contrast < targetContrast; i++) {
        adjusted = mixRgb(adjusted, target, 0.12);
        contrast = contrastRatio(adjusted, textRgb);
    }

    const adjustedHex = sanitizeHexColor(rgbToHex(adjusted));
    return adjustedHex || surfaceColor || fallbackSurface;
}

const SESSION_SCALAR_KEYS = [
    'id',
    'roomCode',
    'host',
    'isTournament',
    'tournamentInfo',
    'createdAt',
    'updatedAt',
    'lastActivity',
    'timeLimit',
    'questionTimeLimit'
];

const SESSION_RESERVED_KEYS = new Set([
    ...SESSION_SCALAR_KEYS,
    'quiz',
    'players',
    'answers',
    'currentQuestionIndex',
    'gameState',
    'playersReady'
]);

function isPlainObject(value) {
    return value !== null && typeof value === 'object';
}

function clonePlainObject(value) {
    return isPlainObject(value) ? { ...value } : null;
}

function normalizeIndexedSequence(value) {
    if (Array.isArray(value)) return value;
    if (!isPlainObject(value)) return [];
    return Object.keys(value)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => value[key]);
}

function pickFirstDefined(key, ...sources) {
    for (const source of sources) {
        if (source && source[key] !== undefined) {
            return source[key];
        }
    }
    return undefined;
}

function mergeQuizForSanitize(primary, fallback) {
    const primaryQuiz = isPlainObject(primary) ? primary : null;
    const fallbackQuiz = isPlainObject(fallback) ? fallback : null;

    if (!primaryQuiz && !fallbackQuiz) {
        return null;
    }

    const merged = { ...(fallbackQuiz || {}) };

    if (primaryQuiz) {
        Object.assign(merged, primaryQuiz);
        if ('questions' in primaryQuiz) {
            merged.questions = primaryQuiz.questions;
        }
    }

    if (!('questions' in merged) && fallbackQuiz && 'questions' in fallbackQuiz) {
        merged.questions = fallbackQuiz.questions;
    }

    return merged;
}

const OPTION_TEXT_KEYS = ['text', 'label', 'value', 'answer', 'content', 'name', 'title'];

function extractTextContent(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        const parts = value.map((entry) => extractTextContent(entry)).filter(Boolean);
        return parts.join(', ');
    }
    if (typeof value === 'object') {
        for (const key of OPTION_TEXT_KEYS) {
            if (typeof value[key] === 'string' || typeof value[key] === 'number' || typeof value[key] === 'boolean') {
                return String(value[key]);
            }
        }
        const firstString = Object.values(value).find((entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean');
        if (firstString !== undefined) {
            return String(firstString);
        }
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }
    return String(value);
}

function sanitizeQuestionData(question, index = 0) {
    const fallbackQuestion = {
        id: `q_${index}`,
        question: `Question ${index + 1}`,
        options: [],
        correctAnswer: 0,
        explanation: ''
    };

    if (!question || typeof question !== 'object') {
        return fallbackQuestion;
    }

    const sanitized = { ...question };
    sanitized.id = typeof question.id === 'string' ? question.id : `q_${index}`;
    sanitized.question = extractTextContent(question.question ?? question.prompt ?? fallbackQuestion.question) || fallbackQuestion.question;
    const rawOptions = normalizeIndexedSequence(question.options);

    sanitized.options = rawOptions
        .map((option, optionIndex) => extractTextContent(option) || `Option ${optionIndex + 1}`)
        .filter((optionText) => optionText.length > 0);

    if (sanitized.options.length === 0) {
        sanitized.options = fallbackQuestion.options;
    }

    const explanation = extractTextContent(question.explanation ?? question.detail ?? '');
    sanitized.explanation = explanation;

    let correctAnswer = Number.isInteger(question.correctAnswer)
        ? question.correctAnswer
        : Number.isInteger(question.correct_answer)
        ? question.correct_answer
        : Number.isInteger(question.correct_answer_index)
        ? question.correct_answer_index
        : Number.parseInt(question.correctAnswerIndex, 10);

    if (!Number.isFinite(correctAnswer)) {
        correctAnswer = 0;
    }

    if (sanitized.options.length > 0) {
        correctAnswer = Math.min(Math.max(correctAnswer, 0), sanitized.options.length - 1);
    } else {
        correctAnswer = 0;
    }

    sanitized.correctAnswer = correctAnswer;
    return sanitized;
}

function sanitizeQuizData(quiz) {
    if (!quiz || typeof quiz !== 'object') return quiz;
    const sanitizedQuiz = { ...quiz };
    const rawQuestions = normalizeIndexedSequence(quiz.questions);
    sanitizedQuiz.questions = rawQuestions.map((question, index) => sanitizeQuestionData(question, index));
    if (sanitizedQuiz.metadata && typeof sanitizedQuiz.metadata === 'object') {
        sanitizedQuiz.metadata = { ...sanitizedQuiz.metadata };
        if (sanitizedQuiz.metadata.color_palette && typeof sanitizedQuiz.metadata.color_palette === 'object') {
            sanitizedQuiz.metadata.color_palette = { ...sanitizedQuiz.metadata.color_palette };
        }
    }
    if (sanitizedQuiz.theme && typeof sanitizedQuiz.theme === 'object') {
        sanitizedQuiz.theme = { ...sanitizedQuiz.theme };
    }
    return sanitizedQuiz;
}

function sanitizeSessionData(session, fallbackSession = null) {
    const sessionData = isPlainObject(session) ? session : null;
    const fallbackData = isPlainObject(fallbackSession) ? fallbackSession : null;

    if (!sessionData && !fallbackData) {
        return session;
    }

    const sanitizedSession = {};

    for (const key of SESSION_SCALAR_KEYS) {
        const value = pickFirstDefined(key, sessionData, fallbackData);
        if (value !== undefined) {
            sanitizedSession[key] = value;
        }
    }

    const mergedQuiz = mergeQuizForSanitize(sessionData?.quiz, fallbackData?.quiz);
    if (mergedQuiz) {
        sanitizedSession.quiz = sanitizeQuizData(mergedQuiz);
    }

    const playersRaw = pickFirstDefined('players', sessionData, fallbackData);
    sanitizedSession.players = clonePlainObject(playersRaw) || {};

    const answersRaw = pickFirstDefined('answers', sessionData, fallbackData);
    sanitizedSession.answers = clonePlainObject(answersRaw) || {};

    const currentIndex = pickFirstDefined('currentQuestionIndex', sessionData, fallbackData);
    sanitizedSession.currentQuestionIndex = Number.isInteger(currentIndex) ? currentIndex : 0;

    const gameState = pickFirstDefined('gameState', sessionData, fallbackData);
    sanitizedSession.gameState = typeof gameState === 'string' ? gameState : 'waiting';

    const playersReady = pickFirstDefined('playersReady', sessionData, fallbackData);
    if (isPlainObject(playersReady)) {
        sanitizedSession.playersReady = { ...playersReady };
    }

    if (sessionData || fallbackData) {
        const remainderSources = [fallbackData, sessionData];
        for (const source of remainderSources) {
            if (!isPlainObject(source)) continue;
            for (const [key, value] of Object.entries(source)) {
                if (SESSION_RESERVED_KEYS.has(key)) continue;
                if (sanitizedSession[key] !== undefined) continue;
                sanitizedSession[key] = value;
            }
        }
    }

    return sanitizedSession;
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
                averageScore: 0,
                theme: quiz.theme || quiz.metadata?.color_palette || null,
                metadata: quiz.metadata || (quiz.theme ? { color_palette: quiz.theme } : null)
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
        this.themeDefaults = this.captureThemeDefaults();
        this.currentTheme = null;
        this.lastQuestionIndex = -1;

        // Loading overlay progress state
        this.loadingProgressStart = null;
        this.loadingProgressTimer = null;
        this.loadingProgressCompletionTimeout = null;
        this.loadingProgressBar = null;
        this.loadingProgressLabel = null;
        this.loadingProgressLastStageText = null;
        this.loadingProgressValue = 0;
        this.loadingProgressStages = [
            { threshold: 0, text: 'Initializing request' },
            { threshold: 0.2, text: 'Drafting questions' },
            { threshold: 0.45, text: 'Verifying answers' },
            { threshold: 0.7, text: 'Designing experience' },
            { threshold: 0.85, text: 'Packaging quiz' }
        ];
        
        // Browser history management
        this.navigationStack = ['welcome'];
        this.isNavigatingBack = false;
        
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

    captureThemeDefaults() {
        const styles = getComputedStyle(document.documentElement);
        const read = (varName) => styles.getPropertyValue(varName).trim();
        return {
            primary: read('--primary-accent-color'),
            secondary: read('--secondary-accent-color-1'),
            accent: read('--secondary-accent-color-2'),
            tertiaryAccent: read('--secondary-accent-color-3'),
            background: read('--background-primary'),
            surface: read('--surface-color') || read('--panel-background'),
            textPrimary: read('--text-color-primary'),
            textSecondary: read('--text-color-secondary'),
            gradientStart: read('--background-gradient-start') || read('--background-primary'),
            gradientEnd: read('--background-gradient-end') || read('--background-primary'),
            border: read('--border-color-subtle'),
            shadow: read('--shadow-color-soft'),
            accentGlow: read('--accent-glow-color'),
            secondaryGlow: read('--secondary-glow-color'),
            decorative: read('--decorative-line-color')
        };
    }

    normalizeTheme(themeData) {
        if (!themeData || typeof themeData !== 'object') return null;
        const palette = themeData.color_palette && typeof themeData.color_palette === 'object'
            ? themeData.color_palette
            : themeData;
        const gradientArray = Array.isArray(palette.gradient)
            ? palette.gradient
            : Array.isArray(palette.gradient_colors)
                ? palette.gradient_colors
                : [];
        const normalized = {
            primary: sanitizeHexColor(palette.primary),
            secondary: sanitizeHexColor(palette.secondary),
            accent: sanitizeHexColor(palette.accent),
            neutral: sanitizeHexColor(palette.neutral),
            background: sanitizeHexColor(palette.background),
            surface: sanitizeHexColor(palette.surface),
            textPrimary: sanitizeHexColor(palette.text_primary || palette.textPrimary),
            textSecondary: sanitizeHexColor(palette.text_secondary || palette.textSecondary),
            gradientStart: sanitizeHexColor(palette.gradient_start || palette.gradientStart || gradientArray[0]),
            gradientEnd: sanitizeHexColor(palette.gradient_end || palette.gradientEnd || gradientArray[1] || gradientArray[0]),
            accentGlow: sanitizeHexColor(palette.accent_glow || palette.glow),
            secondaryGlow: sanitizeHexColor(palette.secondary_glow),
            decorative: sanitizeHexColor(palette.decorative || palette.grid_line),
            tertiary: sanitizeHexColor(palette.tertiary || palette.tertiary_accent || palette.secondary_accent),
            border: sanitizeHexColor(palette.border)
        };
        const hasColor = Object.values(normalized).some(Boolean);
        return hasColor ? normalized : null;
    }

    applyQuizTheme(themeData) {
        if (!this.themeDefaults) {
            this.themeDefaults = this.captureThemeDefaults();
        }
        const normalized = this.normalizeTheme(themeData);
        if (!normalized) {
            this.resetTheme();
            return;
        }

        const defaults = this.themeDefaults;
        const rootStyle = document.documentElement.style;

        const primary = normalized.primary || defaults.primary;
        const secondary = normalized.secondary || defaults.secondary;
        const accent = normalized.accent || defaults.accent;
        const background = normalized.background || defaults.background;
        const textPrimary = normalized.textPrimary || defaults.textPrimary;
        const textSecondary = normalized.textSecondary || defaults.textSecondary;
        const tertiary = normalized.tertiary || accent || defaults.tertiaryAccent;

        const surfaceBase = normalized.surface || background || defaults.surface;

        const gradientStart = normalized.gradientStart || background || defaults.gradientStart;
        const gradientEnd = normalized.gradientEnd || background || defaults.gradientEnd;

        const borderColor = colorWithAlpha(normalized.border || textPrimary || primary, 0.18, defaults.border);
        const shadowColor = colorWithAlpha(normalized.shadow || textPrimary || primary, 0.12, defaults.shadow);
        const accentGlow = colorWithAlpha(normalized.accentGlow || accent || secondary || primary, 0.2, defaults.accentGlow);
        const secondaryGlow = colorWithAlpha(normalized.secondaryGlow || secondary || primary, 0.16, defaults.secondaryGlow);
        const decorative = colorWithAlpha(normalized.decorative || normalized.neutral || textSecondary || primary, 0.08, defaults.decorative);

        const baseContrastBackgrounds = [
            surfaceBase,
            background,
            gradientStart,
            gradientEnd,
            defaults.surface,
            defaults.background
        ].filter(Boolean);

        const accessibleTextPrimary = ensureAccessibleTextColor(textPrimary, baseContrastBackgrounds, defaults.textPrimary);
        const accessibleSurface = ensureSurfaceContrast(surfaceBase, accessibleTextPrimary, defaults.surface) || defaults.surface;
        const secondaryContrastBackgrounds = [
            accessibleSurface,
            background,
            gradientStart,
            gradientEnd,
            defaults.surface,
            defaults.background
        ].filter(Boolean);
        const accessibleTextSecondary = ensureAccessibleTextColor(textSecondary, secondaryContrastBackgrounds, defaults.textSecondary);

        normalized.textPrimary = accessibleTextPrimary;
        normalized.textSecondary = accessibleTextSecondary;
        normalized.surface = sanitizeHexColor(accessibleSurface) || accessibleSurface;

        rootStyle.setProperty('--primary-accent-color', primary);
        rootStyle.setProperty('--secondary-accent-color-1', secondary);
        rootStyle.setProperty('--secondary-accent-color-2', accent);
        rootStyle.setProperty('--secondary-accent-color-3', tertiary || defaults.tertiaryAccent);
        rootStyle.setProperty('--background-primary', background);
        rootStyle.setProperty('--surface-color', accessibleSurface);
        rootStyle.setProperty('--panel-background', accessibleSurface);
        rootStyle.setProperty('--text-color-primary', accessibleTextPrimary);
        rootStyle.setProperty('--text-color-secondary', accessibleTextSecondary);
        rootStyle.setProperty('--background-gradient-start', gradientStart);
        rootStyle.setProperty('--background-gradient-end', gradientEnd);
        rootStyle.setProperty('--border-color-subtle', borderColor);
        rootStyle.setProperty('--shadow-color-soft', shadowColor);
        rootStyle.setProperty('--accent-glow-color', accentGlow);
        rootStyle.setProperty('--secondary-glow-color', secondaryGlow);
        rootStyle.setProperty('--decorative-line-color', decorative);

        this.currentTheme = normalized;
    }

    resetTheme() {
        if (!this.themeDefaults) {
            this.themeDefaults = this.captureThemeDefaults();
        }
        const defaults = this.themeDefaults;
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--primary-accent-color', defaults.primary);
        rootStyle.setProperty('--secondary-accent-color-1', defaults.secondary);
        rootStyle.setProperty('--secondary-accent-color-2', defaults.accent);
        rootStyle.setProperty('--secondary-accent-color-3', defaults.tertiaryAccent);
        rootStyle.setProperty('--background-primary', defaults.background);
        rootStyle.setProperty('--surface-color', defaults.surface);
        rootStyle.setProperty('--panel-background', defaults.surface);
        rootStyle.setProperty('--text-color-primary', defaults.textPrimary);
        rootStyle.setProperty('--text-color-secondary', defaults.textSecondary);
        rootStyle.setProperty('--background-gradient-start', defaults.gradientStart);
        rootStyle.setProperty('--background-gradient-end', defaults.gradientEnd);
        rootStyle.setProperty('--border-color-subtle', defaults.border);
        rootStyle.setProperty('--shadow-color-soft', defaults.shadow);
        rootStyle.setProperty('--accent-glow-color', defaults.accentGlow);
        rootStyle.setProperty('--secondary-glow-color', defaults.secondaryGlow);
        rootStyle.setProperty('--decorative-line-color', defaults.decorative);
        this.currentTheme = null;
    }

    extractQuizTheme(quiz) {
        if (!quiz || typeof quiz !== 'object') return null;
        if (quiz.theme) return quiz.theme;
        if (quiz.metadata && quiz.metadata.color_palette) {
            return quiz.metadata.color_palette;
        }
        return null;
    }

    renderPalette(themeData) {
        const normalized = this.normalizeTheme(themeData);
        if (!normalized) return '';
        const swatches = [
            { label: 'Primary', value: normalized.primary },
            { label: 'Secondary', value: normalized.secondary },
            { label: 'Accent', value: normalized.accent }
        ].filter(entry => entry.value);
        if (!swatches.length) return '';
        return `
            <div class="quiz-item-palette">
                ${swatches.map(entry => `<span><span class="palette-swatch" style="--swatch-color: ${entry.value};"></span>${entry.label}</span>`).join('')}
            </div>
        `;
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

        this.resetTheme();
        
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
                    <div class="selected-quiz-details">${quiz.questions.length} questions • by ${quiz.createdBy}</div>
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
        
        const themeSource = this.selectedTournamentQuizzes.find(q => this.extractQuizTheme(q));
        const palette = themeSource ? this.extractQuizTheme(themeSource) : null;
        const metadata = palette
            ? { ...(themeSource?.metadata || {}), color_palette: palette }
            : { ...(themeSource?.metadata || {}) };

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
            })),
            theme: palette || null,
            metadata
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

    connectWebSocket() {
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
                reject(new Error('Connection timeout'));
            }, 5000);
            
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
                }
            };
            
            this.socket.onclose = (event) => {
                console.log('🔌 WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
                clearTimeout(connectionTimeout);
                if (event.code !== 1000) { // Not a normal closure
                    this.showToast('Connection lost', 'error');
                }
            };
            
            this.socket.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                clearTimeout(connectionTimeout);
                reject(error);
            };
        });
    }

    sendMessage(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
                this.socket.send(JSON.stringify(data));
                console.log('📤 Sent message:', data);
            } catch (error) {
                console.error('❌ Error sending message:', error);
            }
        } else {
            console.error('❌ Cannot send message: WebSocket not connected. ReadyState:', this.socket?.readyState);
            console.error('❌ WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
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
        const sanitizedQuiz = sanitizeQuizData(data.quiz);
        const sessionTemplate = {
            id: data.sessionId,
            quiz: sanitizedQuiz,
            players: {},
            gameState: 'waiting',
            host: this.socket?.id || 'host'
        };

        this.hideLoading();
        this.gameState.currentSession = sanitizeSessionData(sessionTemplate);
        this.gameState.currentQuiz = this.gameState.currentSession.quiz || sanitizedQuiz;

        this.applyQuizTheme(this.extractQuizTheme(sanitizedQuiz));
        
        // Save quiz to Firebase
        try {
            const quizId = await this.quizDatabase.saveQuiz(sanitizedQuiz);
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
        const sanitizedQuiz = sanitizeQuizData(data.quiz);
        const sessionTemplate = {
            id: data.sessionId,
            quiz: sanitizedQuiz,
            players: {},
            gameState: 'waiting',
            host: this.socket?.id || 'host',
            isTournament: true,
            tournamentInfo: data.tournamentInfo
        };

        this.hideLoading();
        this.gameState.currentSession = sanitizeSessionData(sessionTemplate);
        this.gameState.currentQuiz = this.gameState.currentSession.quiz || sanitizedQuiz;

        this.applyQuizTheme(this.extractQuizTheme(sanitizedQuiz));
        
        // Save tournament quiz to Firebase
        try {
            const quizId = await this.quizDatabase.saveQuiz(sanitizedQuiz);
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
        const sanitizedQuiz = sanitizeQuizData(data.quiz);
        const fallbackSession = {
            id: data.sessionId,
            quiz: sanitizedQuiz,
            players: {},
            gameState: 'waiting',
            host: this.socket?.id || 'host'
        };
        const sanitizedSession = sanitizeSessionData(data.session, fallbackSession);

        // Clear play quiz timeout
        if (this.playQuizTimeout) {
            clearTimeout(this.playQuizTimeout);
            this.playQuizTimeout = null;
        }
        
        this.hideLoading();
        this.gameState.currentSession = sanitizedSession;
        this.gameState.currentQuiz = sanitizedSession.quiz || sanitizedQuiz;

        this.applyQuizTheme(this.extractQuizTheme(sanitizedQuiz));
        
        this.showToast('Quiz loaded successfully!', 'success');
        this.updateLobbyDisplay();
        this.showScreen('lobby');
    }

    handleSessionUpdate(data) {
        const previousSession = this.gameState.currentSession;
        const fallbackSession = previousSession || (this.gameState.currentQuiz ? { quiz: this.gameState.currentQuiz } : null);
        const sanitizedSession = sanitizeSessionData(data.session, fallbackSession);
        console.log('🔄 Session update received:', sanitizedSession.gameState);
        this.gameState.currentSession = sanitizedSession;
        if (sanitizedSession.quiz) {
            this.gameState.currentQuiz = sanitizedSession.quiz;
        }
        this.applyQuizTheme(this.extractQuizTheme(sanitizedSession?.quiz));
        const sanitizedPayload = { ...data, session: sanitizedSession };
        
        // Check if game state changed
        if (previousSession && previousSession.gameState !== sanitizedSession.gameState) {
            console.log('🎮 Game state changed from', previousSession.gameState, 'to', sanitizedSession.gameState);
            
            if (sanitizedSession.gameState === 'playing') {
                // Transition to playing state
                this.handleSessionState(sanitizedPayload);
                return;
            } else if (sanitizedSession.gameState === 'waiting' && this.currentScreen !== 'lobby') {
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
        if (sanitizedSession.gameState === 'playing' && this.currentScreen !== 'quiz') {
            console.log('🎯 Session is playing but we\'re not in quiz screen - transitioning to quiz');
            this.handleSessionState(sanitizedPayload);
            return;
        }
        
        // If this is the first session update after playing a quiz, show lobby
        if (!previousSession && sanitizedSession.gameState === 'waiting' && this.currentScreen !== 'lobby') {
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
        const fallbackSession = this.gameState.currentSession || (this.gameState.currentQuiz ? { quiz: this.gameState.currentQuiz } : null);
        const sanitizedSession = sanitizeSessionData(data.session, fallbackSession);
        console.log('🎮 handleSessionState() called with gameState:', sanitizedSession.gameState);
        this.gameState.currentSession = sanitizedSession;
        if (sanitizedSession.quiz) {
            this.gameState.currentQuiz = sanitizedSession.quiz;
        }
        this.applyQuizTheme(this.extractQuizTheme(sanitizedSession?.quiz));
        
        if (sanitizedSession.gameState === 'waiting') {
            console.log('⏳ Session state: waiting - showing lobby');
            this.hideLoading(); // Hide loading if we're back to waiting
            this.resetStartButton(); // Reset button state when returning to waiting
            this.updateLobbyDisplay();
            this.showScreen('lobby');
        } else if (sanitizedSession.gameState === 'playing') {
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
            console.log('❓ Unknown session state:', sanitizedSession.gameState);
        }
    }

    handleQuestionResults(data) {
        console.log('📊 Question results received:', data);
        const questionIndex = data.questionIndex ?? data.currentQuestionIndex ?? this.gameState.currentSession?.currentQuestionIndex ?? 0;
        const currentQuestion = sanitizeQuestionData(data.currentQuestion, questionIndex);
        
        // Only show results if we're currently in quiz mode
        if (this.currentScreen !== 'quiz') {
            console.log('⚠️ Ignoring question results - not in quiz mode. Current screen:', this.currentScreen);
            return;
        }
        
        // Color code the answer options
        this.colorCodeAnswers(currentQuestion.correctAnswer);
        
        // Show inline results
        this.showInlineResults({ ...data, currentQuestion });
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
        const currentQuestion = data.currentQuestion;
        
        // Calculate points earned for this question
        let pointsEarned = 0;
        let wasCorrect = false;
        
        if (currentPlayer && data.playerAnswers[currentPlayer.id]) {
            const playerData = data.playerAnswers[currentPlayer.id];
            const previousScore = this.gameState.previousScore || 0;
            pointsEarned = playerData.score - previousScore;
            this.gameState.previousScore = playerData.score;
            wasCorrect = playerData.answer === currentQuestion.correctAnswer;
        }
        
        // Update explanation
        const explanationElement = document.getElementById('inline-explanation');
        if (currentQuestion.explanation) {
            explanationElement.textContent = currentQuestion.explanation;
        } else {
            const correctOption = currentQuestion.options?.[currentQuestion.correctAnswer];
            explanationElement.textContent = correctOption
                ? `The correct answer is: ${correctOption}`
                : 'The correct answer will appear here shortly.';
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
        if (data.playerAnswers && Object.keys(data.playerAnswers).length > 0) {
            console.log('💾 Ensuring highscores are saved for quiz completion');
            this.saveHighscores(data.playerAnswers);
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
        
        // Convert player answers to sorted array
        const players = Object.entries(playerAnswers).map(([id, data]) => ({
            id,
            name: data.name,
            score: data.score || 0
        }));
        
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
                <div class="score">${player.score} pts (${player.percentage}%)</div>
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
                    <div class="score">${score.score} pts (${score.percentage}%)</div>
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
        const fallbackSession = this.gameState.currentSession || (this.gameState.currentQuiz ? { quiz: this.gameState.currentQuiz } : null);
        const sanitizedSession = sanitizeSessionData(data.session, fallbackSession);
        
        // Clear timeout and hide loading when quiz starts
        if (this.startQuizTimeout) {
            clearTimeout(this.startQuizTimeout);
            this.startQuizTimeout = null;
        }
        this.hideLoading();
        this.resetStartButton(); // Reset button state when quiz starts
        
        // Update session with the started quiz data
        this.gameState.currentSession = sanitizedSession;
        if (sanitizedSession.quiz) {
            this.gameState.currentQuiz = sanitizedSession.quiz;
        }
        this.applyQuizTheme(this.extractQuizTheme(sanitizedSession?.quiz));
        
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

        if (!session.quiz) {
            console.warn('⚠️ Session missing quiz data');
            return;
        }
        
        this.applyQuizTheme(this.extractQuizTheme(session.quiz));
        
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

        const currentPlayer = this.getCurrentPlayer();
        const currentPlayerId = currentPlayer?.id;
        const playerAnswers = currentPlayerId && session.answers ? session.answers[currentPlayerId] : undefined;
        const selectedAnswerIndex = typeof playerAnswers?.[currentQuestionIndex] === 'number'
            ? playerAnswers[currentQuestionIndex]
            : (typeof currentPlayer?.currentAnswer === 'number' ? currentPlayer.currentAnswer : undefined);
        const hasAnswered = Boolean(currentPlayer?.hasAnswered);

        const isNewQuestion = this.lastQuestionIndex !== currentQuestionIndex;
        if (isNewQuestion) {
            this.lastQuestionIndex = currentQuestionIndex;
            this.gameState.previousScore = currentPlayer ? currentPlayer.score : 0;
        }
        
        // Update answer options
        const optionsContainer = document.getElementById('answer-options');
        optionsContainer.innerHTML = '';
        
        const currentOptions = Array.isArray(currentQuestion.options)
            ? currentQuestion.options
            : (currentQuestion.options && typeof currentQuestion.options === 'object')
            ? Object.values(currentQuestion.options)
            : [];

        currentOptions.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = 'answer-option';
            const optionText = typeof option === 'string' ? option : extractTextContent(option);
            button.textContent = optionText || `Option ${index + 1}`;

            if (!hasAnswered) {
                button.onclick = () => this.selectAnswer(index);
            } else {
                button.disabled = true;
            }

            if (selectedAnswerIndex === index) {
                button.classList.add('selected');
                button.disabled = true;
            }

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

            const statusClass = player.hasAnswered ? 'answered' : 'pending';
            const statusLabel = player.hasAnswered ? 'Answer submitted' : 'Waiting to answer';
            
            scoreItem.innerHTML = `
                <span class="live-score-rank">${index + 1}</span>
                <span class="live-score-name">
                    <span class="live-score-status ${statusClass}" title="${statusLabel}" aria-label="${statusLabel}"></span>
                    ${player.name}
                </span>
                <span class="live-score-points">${player.score}</span>
            `;
            
            leaderboardContainer.appendChild(scoreItem);
        });
    }

    selectAnswer(answerIndex) {
        console.log('📝 Selecting answer:', answerIndex);

        const currentPlayer = this.getCurrentPlayer();
        if (currentPlayer?.hasAnswered) {
            console.log('⚠️ Answer already submitted - ignoring duplicate click');
            return;
        }
        
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

    getLoadingElements() {
        return {
            overlay: document.getElementById('loading-overlay'),
            message: document.getElementById('loading-message'),
            submessage: document.getElementById('loading-submessage'),
            progressBar: document.getElementById('loading-progress-bar'),
            progressLabel: document.getElementById('loading-progress-label')
        };
    }

    cancelLoadingProgressAnimation() {
        if (this.loadingProgressTimer) {
            clearTimeout(this.loadingProgressTimer);
            this.loadingProgressTimer = null;
        }
        if (this.loadingProgressRaf) {
            cancelAnimationFrame(this.loadingProgressRaf);
            this.loadingProgressRaf = null;
        }
    }

    resetLoadingProgress() {
        this.cancelLoadingProgressAnimation();
        this.loadingProgressStart = null;
        this.loadingProgressValue = 0;
        const { progressBar, progressLabel } = this.getLoadingElements();
        if (progressBar) {
            progressBar.style.transition = 'none';
            progressBar.style.width = '0%';
            void progressBar.offsetWidth;
            progressBar.style.transition = '';
        }
        const initialStage = this.loadingProgressStages[0]?.text || 'Preparing...';
        if (progressLabel) {
            progressLabel.textContent = `${initialStage} (0%)`;
        }
        this.loadingProgressLastStageText = null;
    }

    startLoadingProgress() {
        const { progressBar, progressLabel } = this.getLoadingElements();
        if (!progressBar || !progressLabel) {
            return;
        }

        this.loadingProgressBar = progressBar;
        this.loadingProgressLabel = progressLabel;
        this.loadingProgressStart = Date.now();
        this.loadingProgressLastStageText = null;
        this.loadingProgressValue = 0;

        progressBar.style.transition = 'none';
        progressBar.style.width = '0%';
        void progressBar.offsetWidth;
        progressBar.style.transition = '';

        const initialStage = this.loadingProgressStages[0]?.text || 'Preparing...';
        progressLabel.textContent = `${initialStage} (0%)`;

        this.cancelLoadingProgressAnimation();
        this.loadingProgressTimer = setTimeout(() => this.updateLoadingProgress(), this.getLoadingProgressDelay());
    }

    getLoadingProgressDelay() {
        if (this.loadingProgressValue < 20) {
            return 140 + Math.random() * 120;
        }
        if (this.loadingProgressValue < 45) {
            return 180 + Math.random() * 150;
        }
        if (this.loadingProgressValue < 70) {
            return 220 + Math.random() * 180;
        }
        return 260 + Math.random() * 220;
    }

    getLoadingProgressEasing() {
        if (this.loadingProgressValue < 20) {
            return 0.35 + Math.random() * 0.1;
        }
        if (this.loadingProgressValue < 45) {
            return 0.25 + Math.random() * 0.08;
        }
        if (this.loadingProgressValue < 70) {
            return 0.18 + Math.random() * 0.06;
        }
        if (this.loadingProgressValue < 85) {
            return 0.12 + Math.random() * 0.05;
        }
        return 0.08 + Math.random() * 0.03;
    }

    updateLoadingProgress() {
        const progressBar = this.loadingProgressBar || document.getElementById('loading-progress-bar');
        const progressLabel = this.loadingProgressLabel || document.getElementById('loading-progress-label');

        if (!progressBar || !progressLabel) {
            this.cancelLoadingProgressAnimation();
            return;
        }

        if (this.loadingProgressTimer) {
            clearTimeout(this.loadingProgressTimer);
            this.loadingProgressTimer = null;
        }

        const maxAutoProgress = 96;
        const remaining = Math.max(0, maxAutoProgress - this.loadingProgressValue);
        if (remaining > 0) {
            const easing = this.getLoadingProgressEasing();
            const increment = Math.max(1, Math.round(remaining * easing * Math.random())) || 1;
            this.loadingProgressValue = Math.min(maxAutoProgress, this.loadingProgressValue + increment);
        }

        const percent = Math.min(99, Math.max(0, Math.round(this.loadingProgressValue)));
        progressBar.style.width = `${percent}%`;

        const fraction = percent / 100;
        let currentStage = this.loadingProgressStages[0];
        for (const step of this.loadingProgressStages) {
            if (fraction >= step.threshold) {
                currentStage = step;
            } else {
                break;
            }
        }

        const stageText = currentStage?.text || 'Working...';
        if (stageText !== this.loadingProgressLastStageText) {
            this.loadingProgressLastStageText = stageText;
        }

        progressLabel.textContent = `${stageText} (${percent}%)`;

        if (this.loadingProgressValue < maxAutoProgress) {
            this.loadingProgressTimer = setTimeout(() => this.updateLoadingProgress(), this.getLoadingProgressDelay());
        }
    }

    completeLoadingProgress() {
        this.cancelLoadingProgressAnimation();
        this.loadingProgressStart = null;
        this.loadingProgressValue = 100;

        const { progressBar, progressLabel } = this.getLoadingElements();
        let delay = 0;

        if (progressBar) {
            progressBar.style.transition = 'width 0.35s ease-out';
            progressBar.style.width = '100%';
            delay = 360;
        }

        if (progressLabel) {
            progressLabel.textContent = 'Ready! (100%)';
        }

        return delay;
    }

    showLoading(message, submessage = '') {
        console.log('🔄 showLoading() called with:', message, submessage);
        const { overlay, message: loadingMessage, submessage: loadingSubmessage } = this.getLoadingElements();

        if (!overlay || !loadingMessage || !loadingSubmessage) {
            console.error('❌ Loading elements not found in DOM');
            return;
        }

        loadingMessage.textContent = message;
        loadingSubmessage.textContent = submessage;

        if (this.loadingProgressCompletionTimeout) {
            clearTimeout(this.loadingProgressCompletionTimeout);
            this.loadingProgressCompletionTimeout = null;
        }

        this.resetLoadingProgress();
        overlay.classList.remove('hidden');
        this.startLoadingProgress();

        console.log('✅ Loading overlay should now be visible');
    }

    hideLoading(options = {}) {
        const { overlay } = this.getLoadingElements();
        if (!overlay) {
            console.error('❌ Loading overlay not found in DOM');
            return;
        }

        if (this.loadingProgressCompletionTimeout) {
            clearTimeout(this.loadingProgressCompletionTimeout);
            this.loadingProgressCompletionTimeout = null;
        }

        const delay = options.immediate ? 0 : this.completeLoadingProgress();

        this.loadingProgressCompletionTimeout = setTimeout(() => {
            overlay.classList.add('hidden');
            this.resetLoadingProgress();
            this.loadingProgressCompletionTimeout = null;
            console.log('🔄 Loading overlay hidden');
        }, delay);
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
            const paletteHtml = this.renderPalette(this.extractQuizTheme(quiz));
            
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
                    ${quiz.averageScore ? `
                        <div class="quiz-stat">
                            <span><i class="ph ph-star"></i></span>
                            <span>${quiz.averageScore}% avg</span>
                        </div>
                    ` : ''}
                </div>
                ${paletteHtml}
                <div class="quiz-item-actions">
                    <button class="btn btn-primary" onclick="window.quizGame.playQuiz('${quiz.id}')">Play Quiz</button>
                    <button class="btn btn-outline" onclick="window.quizGame.viewHighscores('${quiz.id}', '${quiz.title || quiz.topic}')">View Highscores</button>
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
            
            if (!quiz) {
                this.hideLoading();
                this.showToast('Quiz not found. Please try again.', 'error');
                return;
            }

            this.applyQuizTheme(this.extractQuizTheme(quiz));
            
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
                document.body.removeChild(modal);
            }
        };
        
        modal.innerHTML = `
            <div class="highscores-content">
                <div class="highscores-header">
                    <h3>Highscores: ${quizTitle}</h3>
                    <button class="close-btn" onclick="document.body.removeChild(this.closest('.highscores-modal'))">×</button>
                </div>
                <ul class="highscore-list">
                    ${highscores.length === 0 ? '<li class="highscore-item">No scores yet. Be the first to play!</li>' : 
                        highscores.map((score, index) => `
                            <li class="highscore-item">
                                <span class="highscore-rank">#${index + 1}</span>
                                <span class="highscore-name">${score.playerName}</span>
                                <span class="highscore-score">
                                    ${score.score} pts (${score.percentage}%)
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
