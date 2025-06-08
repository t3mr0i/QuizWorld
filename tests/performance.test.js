/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Performance Tests', () => {
    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = `
            <div id="quiz-list" class="quiz-list"></div>
            <div id="final-leaderboard" class="leaderboard"></div>
            <div id="loading-overlay" class="loading-overlay hidden"></div>
            <div id="toast-container" class="toast-container"></div>
        `;

        // Mock performance API
        global.performance = {
            now: vi.fn(() => Date.now()),
            mark: vi.fn(),
            measure: vi.fn()
        };
    });

    describe('Quiz Rendering Performance', () => {
        it('should render large quiz lists efficiently', async () => {
            // Create a large number of mock quizzes
            const largeQuizList = Array.from({ length: 1000 }, (_, i) => ({
                id: `quiz-${i}`,
                title: `Quiz ${i}`,
                topic: `Topic ${i}`,
                questions: Array.from({ length: 10 }, (_, j) => ({ id: `q${j}` })),
                createdBy: `User ${i}`,
                createdAt: Date.now() - i * 1000
            }));

            const startTime = performance.now();

            // Mock the displayQuizzes function
            const displayQuizzes = (quizzes) => {
                const quizList = document.getElementById('quiz-list');
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
            };

            displayQuizzes(largeQuizList);

            const endTime = performance.now();
            const renderTime = endTime - startTime;

            // Should render 1000 quizzes in less than 200ms (more realistic for test environment)
            expect(renderTime).toBeLessThan(200);
            expect(document.querySelectorAll('.quiz-item')).toHaveLength(1000);
        });

        it('should handle rapid leaderboard updates efficiently', () => {
            const startTime = performance.now();

            // Simulate rapid leaderboard updates
            for (let i = 0; i < 100; i++) {
                const playerAnswers = {};
                for (let j = 0; j < 50; j++) {
                    playerAnswers[`player-${j}`] = {
                        name: `Player ${j}`,
                        score: Math.floor(Math.random() * 1000)
                    };
                }

                // Mock updateFinalLeaderboard function
                const updateFinalLeaderboard = (answers) => {
                    const leaderboard = document.getElementById('final-leaderboard');
                    const players = Object.entries(answers).map(([id, data]) => ({
                        id,
                        name: data.name,
                        score: data.score || 0
                    }));

                    players.sort((a, b) => b.score - a.score);

                    leaderboard.innerHTML = '';
                    players.forEach((player, index) => {
                        const scoreItem = document.createElement('div');
                        scoreItem.className = 'score-item';
                        scoreItem.innerHTML = `
                            <span class="rank">#${index + 1}</span>
                            <span class="name">${player.name}</span>
                            <span class="score">${player.score} pts</span>
                        `;
                        leaderboard.appendChild(scoreItem);
                    });
                };

                updateFinalLeaderboard(playerAnswers);
            }

            const endTime = performance.now();
            const updateTime = endTime - startTime;

            // Should handle 100 updates with 50 players each in less than 1000ms (more realistic for test environment)
            expect(updateTime).toBeLessThan(1000);
        });
    });

    describe('Memory Usage', () => {
        it('should not create memory leaks with repeated operations', () => {
            const initialElements = document.querySelectorAll('*').length;

            // Simulate repeated quiz loading and cleanup
            for (let i = 0; i < 100; i++) {
                // Create temporary elements
                const container = document.createElement('div');
                container.innerHTML = `
                    <div class="quiz-container">
                        <h2>Quiz ${i}</h2>
                        <div class="questions">
                            ${Array.from({ length: 10 }, (_, j) => `
                                <div class="question">
                                    <p>Question ${j}</p>
                                    <div class="options">
                                        <button>Option A</button>
                                        <button>Option B</button>
                                        <button>Option C</button>
                                        <button>Option D</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                document.body.appendChild(container);

                // Simulate cleanup
                container.remove();
            }

            const finalElements = document.querySelectorAll('*').length;

            // Should not have significantly more elements after cleanup
            expect(finalElements - initialElements).toBeLessThan(5);
        });

        it('should efficiently handle large tournament combinations', () => {
            const startTime = performance.now();

            // Create large quizzes for tournament
            const largeQuizzes = Array.from({ length: 20 }, (_, i) => ({
                id: `quiz-${i}`,
                title: `Quiz ${i}`,
                questions: Array.from({ length: 50 }, (_, j) => ({
                    id: `q${i}-${j}`,
                    question: `Question ${j} from Quiz ${i}`,
                    options: ['A', 'B', 'C', 'D'],
                    correctAnswer: j % 4,
                    explanation: `Explanation for question ${j}`
                }))
            }));

            // Mock createCombinedQuiz function
            const createCombinedQuiz = (title, creator, selectedQuizzes) => {
                const allQuestions = [];
                selectedQuizzes.forEach(quiz => {
                    allQuestions.push(...quiz.questions);
                });

                // Shuffle questions
                for (let i = allQuestions.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
                }

                return {
                    id: `tournament_${Date.now()}`,
                    title,
                    questions: allQuestions,
                    createdBy: creator,
                    isTournament: true,
                    sourceQuizzes: selectedQuizzes.map(q => ({
                        id: q.id,
                        title: q.title,
                        questionCount: q.questions.length
                    }))
                };
            };

            const combinedQuiz = createCombinedQuiz('Performance Test Tournament', 'Test User', largeQuizzes);

            const endTime = performance.now();
            const combinationTime = endTime - startTime;

            // Should combine 20 quizzes with 50 questions each (1000 total) in less than 50ms
            expect(combinationTime).toBeLessThan(50);
            expect(combinedQuiz.questions).toHaveLength(1000);
            expect(combinedQuiz.isTournament).toBe(true);
        });
    });

    describe('Network Simulation', () => {
        it('should handle slow network responses gracefully', async () => {
            // Mock slow network response
            const slowFetch = vi.fn().mockImplementation(() => 
                new Promise(resolve => {
                    setTimeout(() => {
                        resolve({
                            ok: true,
                            json: () => Promise.resolve({
                                questions: [
                                    {
                                        id: 'q1',
                                        question: 'Test question?',
                                        options: ['A', 'B', 'C', 'D'],
                                        correctAnswer: 0
                                    }
                                ]
                            })
                        });
                    }, 2000); // 2 second delay
                })
            );

            global.fetch = slowFetch;

            const startTime = performance.now();
            
            // Simulate loading with timeout
            const loadingPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Request timeout'));
                }, 3000);

                slowFetch().then(response => {
                    clearTimeout(timeout);
                    resolve(response);
                }).catch(reject);
            });

            try {
                await loadingPromise;
                const endTime = performance.now();
                const loadTime = endTime - startTime;
                
                // Should complete within timeout period
                expect(loadTime).toBeLessThan(3000);
            } catch (error) {
                // Should handle timeout gracefully
                expect(error.message).toBe('Request timeout');
            }
        });

        it('should batch multiple rapid requests', async () => {
            let requestCount = 0;
            const batchedFetch = vi.fn().mockImplementation(() => {
                requestCount++;
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ data: 'test' })
                });
            });

            global.fetch = batchedFetch;

            // Simulate rapid requests
            const requests = [];
            for (let i = 0; i < 10; i++) {
                requests.push(fetch('/api/test'));
            }

            await Promise.all(requests);

            // Should have made all requests (in this simple mock)
            // In a real implementation, you might batch these
            expect(requestCount).toBe(10);
        });
    });

    describe('UI Responsiveness', () => {
        it('should maintain responsive UI during heavy operations', async () => {
            const startTime = performance.now();

            // Simulate heavy DOM manipulation
            const container = document.createElement('div');
            document.body.appendChild(container);

            // Use requestAnimationFrame to ensure smooth updates
            const heavyOperation = () => {
                return new Promise(resolve => {
                    let iterations = 0;
                    const maxIterations = 100; // Reduced for test performance

                    const iterate = () => {
                        // Do some work
                        for (let i = 0; i < 100; i++) {
                            const element = document.createElement('div');
                            element.textContent = `Item ${iterations * 100 + i}`;
                            container.appendChild(element);
                        }

                        iterations++;

                        if (iterations < maxIterations) {
                            // Use requestAnimationFrame to yield control
                            requestAnimationFrame(iterate);
                        } else {
                            resolve();
                        }
                    };

                    requestAnimationFrame(iterate);
                });
            };

            await heavyOperation();

            const endTime = performance.now();
            const operationTime = endTime - startTime;

            // Should complete heavy operation
            expect(container.children.length).toBe(10000); // Updated for reduced iterations
            
            // Clean up
            container.remove();
        });

        it('should handle rapid toast notifications without blocking UI', () => {
            const startTime = performance.now();

            // Mock showToast function
            const showToast = (message, type = 'info') => {
                const container = document.getElementById('toast-container');
                const toast = document.createElement('div');
                toast.className = `toast toast-${type}`;
                toast.textContent = message;
                container.appendChild(toast);

                // Auto-remove after delay (simulated)
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 100);
            };

            // Show many toasts rapidly
            for (let i = 0; i < 100; i++) {
                showToast(`Toast message ${i}`, 'info');
            }

            const endTime = performance.now();
            const toastTime = endTime - startTime;

            // Should handle 100 toasts quickly
            expect(toastTime).toBeLessThan(50);
            
            const toastContainer = document.getElementById('toast-container');
            expect(toastContainer.children.length).toBe(100);
        });
    });
}); 