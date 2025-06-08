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
            
            const scoreData = {
                playerName: playerName,
                score: score,
                totalQuestions: totalQuestions,
                percentage: Math.round((score / totalQuestions) * 100),
                timeSpent: timeSpent,
                timestamp: Date.now()
            };
            
            await set(newScoreRef, scoreData);
            
            // Update quiz statistics
            await this.updateQuizStats(quizId, score, totalQuestions);
            
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
                // Sort by score descending, then by time ascending (faster time is better)
                return scores.sort((a, b) => {
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }
                    return a.timeSpent - b.timeSpent;
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
}

export default QuizDatabase; 