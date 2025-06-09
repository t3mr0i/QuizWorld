import { database } from './firebase-config.js';
import { ref, push, set, get, child, query, orderByChild, limitToLast, update } from "firebase/database";

class QuizDatabase {
    constructor() {
        this.db = database;
    }

    // Save a quiz to the database
    async saveQuiz(quiz) {
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

    // Get a quiz by ID
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

    // Get all quizzes (for browsing)
    async getAllQuizzes() {
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
            throw error;
        }
    }

    // Save a highscore for a quiz
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
            
            // Update quiz statistics
            await this.updateQuizStats(quizId, correctAnswers, totalQuestions);
            
            return newScoreRef.key;
        } catch (error) {
            console.error('Error saving highscore:', error);
            throw error;
        }
    }

    // Get highscores for a quiz
    async getHighscores(quizId, limit = 10) {
        try {
            const highscoresRef = ref(this.db, `highscores/${quizId}`);
            const highscoresQuery = query(
                highscoresRef,
                orderByChild('score'),
                limitToLast(limit)
            );
            
            const snapshot = await get(highscoresQuery);
            
            if (snapshot.exists()) {
                const scores = [];
                snapshot.forEach((childSnapshot) => {
                    scores.push(childSnapshot.val());
                });
                // Sort by score descending, then by timestamp (most recent first)
                return scores.sort((a, b) => {
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }
                    return b.timestamp - a.timestamp;
                });
            } else {
                return [];
            }
        } catch (error) {
            console.error('Error getting highscores:', error);
            throw error;
        }
    }

    // Update quiz statistics
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

    // Search quizzes by topic
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

    // Get popular quizzes (most played)
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

    // Get recent quizzes
    async getRecentQuizzes(limit = 10) {
        try {
            const quizzes = await this.getAllQuizzes();
            return quizzes.slice(0, limit);
        } catch (error) {
            console.error('Error getting recent quizzes:', error);
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

export default QuizDatabase; 