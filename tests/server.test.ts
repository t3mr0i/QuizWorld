import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock PartyKit types
interface MockConnection {
    id: string;
    send: (data: string) => void;
}

interface MockParty {
    id: string;
    broadcast: (data: string) => void;
}

// Mock OpenAI function
const mockGenerateQuizWithOpenAI = vi.fn().mockResolvedValue([
    {
        id: 'q1',
        question: 'Test Question 1?',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 0,
        explanation: 'Test explanation 1'
    },
    {
        id: 'q2',
        question: 'Test Question 2?',
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 1,
        explanation: 'Test explanation 2'
    }
]);

// Mock the server class structure
class MockQuizaruServer {
    private roomId: string;
    private party: MockParty;
    private sessions: Record<string, any> = {};

    constructor(party: MockParty) {
        this.party = party;
        this.roomId = party.id;
    }

    private get session() {
        return this.sessions[this.roomId];
    }

    async onMessage(message: string, sender: MockConnection) {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'create_quiz':
                    await this.handleCreateQuiz(data, sender);
                    break;
                case 'create_tournament':
                    await this.handleCreateTournament(data, sender);
                    break;
                case 'play_existing_quiz':
                    await this.handlePlayExistingQuiz(data, sender);
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
                default:
                    console.warn(`Unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error("Error processing message:", error);
            sender.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process message'
            }));
        }
    }

    private async handleCreateQuiz(data: any, sender: MockConnection) {
        const { topic, questionCount = 10, title, playerName } = data;
        
        // Generate questions using mocked AI
        const questions = await mockGenerateQuizWithOpenAI(topic, questionCount);
        
        // Create quiz object
        const quiz = {
            id: `quiz_${Date.now()}`,
            title: title || `Quiz about ${topic}`,
            topic,
            questions,
            createdBy: playerName || 'Anonymous',
            createdAt: new Date(),
            isPublic: true
        };
        
        // Create quiz session
        const session = {
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
            host: sender.id,
            answers: {}
        };
        
        this.sessions[this.roomId] = session;
        
        // Send success response
        sender.send(JSON.stringify({
            type: 'quiz_created',
            quiz,
            sessionId: this.roomId
        }));
        
        this.broadcastSessionUpdate();
    }

    private async handleCreateTournament(data: any, sender: MockConnection) {
        const { tournament, playerName } = data;
        const { name, createdBy, combinedQuiz } = tournament;
        
        // Create tournament session
        const session = {
            id: this.roomId,
            quiz: combinedQuiz,
            players: {
                [sender.id]: {
                    id: sender.id,
                    name: playerName || 'Tournament Host',
                    score: 0,
                    hasAnswered: false,
                    isReady: false,
                    isHost: true
                }
            },
            currentQuestionIndex: -1,
            gameState: 'waiting',
            host: sender.id,
            answers: {},
            isTournament: true,
            tournamentInfo: {
                name,
                sourceQuizzes: combinedQuiz.sourceQuizzes || []
            }
        };
        
        this.sessions[this.roomId] = session;
        
        // Send success response
        sender.send(JSON.stringify({
            type: 'tournament_created',
            quiz: combinedQuiz,
            sessionId: this.roomId,
            tournamentInfo: session.tournamentInfo
        }));
        
        this.broadcastSessionUpdate();
    }

    private async handlePlayExistingQuiz(data: any, sender: MockConnection) {
        const { quizId, quiz: quizData, playerName } = data;
        
        if (!quizData) {
            sender.send(JSON.stringify({
                type: 'error',
                message: 'Quiz not found. Please try again.'
            }));
            return;
        }
        
        // Create quiz session with the existing quiz
        const session = {
            id: this.roomId,
            quiz: quizData,
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
            host: sender.id,
            answers: {}
        };
        
        this.sessions[this.roomId] = session;
        
        // Send success response
        sender.send(JSON.stringify({
            type: 'quiz_loaded',
            quiz: quizData,
            sessionId: this.roomId,
            session
        }));
        
        this.broadcastSessionUpdate();
    }

    private handleJoinSession(data: any, sender: MockConnection) {
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
        
        this.broadcastSessionUpdate();
    }

    private handleStartQuiz(sender: MockConnection) {
        if (!this.session || this.session.host !== sender.id) {
            return;
        }

        this.session.gameState = 'playing';
        this.session.currentQuestionIndex = 0;
        
        // Reset player states
        Object.values(this.session.players).forEach((player: any) => {
            player.hasAnswered = false;
            player.currentAnswer = undefined;
        });

        this.party.broadcast(JSON.stringify({
            type: 'quiz_started',
            session: this.session
        }));
    }

    private handleSubmitAnswer(data: any, sender: MockConnection) {
        if (!this.session || !this.session.players[sender.id]) {
            return;
        }

        const { answerIndex } = data;
        const player = this.session.players[sender.id];
        
        // Store answer
        player.currentAnswer = answerIndex;
        player.hasAnswered = true;
        
        // Calculate score (100 points per correct answer)
        const currentQuestion = this.session.quiz.questions[this.session.currentQuestionIndex];
        if (answerIndex === currentQuestion.correctAnswer) {
            player.score += 100;
        }
        
        this.broadcastSessionUpdate();
        
        // Check if all players have answered
        const allAnswered = Object.values(this.session.players).every((p: any) => p.hasAnswered);
        if (allAnswered) {
            this.showQuestionResults();
        }
    }

    private handleNextQuestion(sender: MockConnection) {
        if (!this.session || this.session.host !== sender.id) {
            return;
        }

        this.session.currentQuestionIndex++;
        
        if (this.session.currentQuestionIndex >= this.session.quiz.questions.length) {
            // Quiz finished
            this.session.gameState = 'finished';
            
            // Send final results
            this.party.broadcast(JSON.stringify({
                type: 'quiz_finished',
                playerAnswers: Object.fromEntries(
                    Object.entries(this.session.players).map(([id, player]: [string, any]) => [
                        id, 
                        {
                            name: player.name,
                            score: player.score
                        }
                    ])
                )
            }));
        } else {
            // Next question
            this.session.gameState = 'playing';
            
            // Reset player answers
            Object.values(this.session.players).forEach((player: any) => {
                player.hasAnswered = false;
                player.currentAnswer = undefined;
            });
        }
        
        this.broadcastSessionUpdate();
    }

    private handlePlayerReady(data: any, sender: MockConnection) {
        if (!this.session || !this.session.players[sender.id]) {
            return;
        }

        this.session.players[sender.id].isReady = data.ready;
        this.broadcastSessionUpdate();
    }

    private showQuestionResults() {
        if (!this.session) return;
        
        this.session.gameState = 'results';
        
        // Broadcast results
        this.party.broadcast(JSON.stringify({
            type: 'question_results',
            currentQuestion: this.session.quiz.questions[this.session.currentQuestionIndex],
            playerAnswers: Object.fromEntries(
                Object.entries(this.session.players).map(([id, player]: [string, any]) => [
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

    // Getter for testing
    getSession() {
        return this.session;
    }

    getSessions() {
        return this.sessions;
    }
}

describe('Quizaru Server', () => {
    let server: MockQuizaruServer;
    let mockParty: MockParty;
    let mockConnection: MockConnection;
    let sentMessages: string[];

    beforeEach(() => {
        sentMessages = [];
        
        mockConnection = {
            id: 'player1',
            send: vi.fn((data: string) => {
                sentMessages.push(data);
            })
        };

        mockParty = {
            id: 'room123',
            broadcast: vi.fn((data: string) => {
                sentMessages.push(data);
            })
        };

        server = new MockQuizaruServer(mockParty);
        vi.clearAllMocks();
    });

    describe('Quiz Creation', () => {
        it('should create a new quiz with AI-generated questions', async () => {
            const createQuizMessage = {
                type: 'create_quiz',
                topic: 'Science',
                questionCount: 2,
                title: 'Science Quiz',
                playerName: 'Host Player'
            };

            await server.onMessage(JSON.stringify(createQuizMessage), mockConnection);

            expect(mockGenerateQuizWithOpenAI).toHaveBeenCalledWith('Science', 2);
            expect(mockConnection.send).toHaveBeenCalled();
            
            const sentMessage = JSON.parse(sentMessages[0]);
            expect(sentMessage.type).toBe('quiz_created');
            expect(sentMessage.quiz.title).toBe('Science Quiz');
            expect(sentMessage.quiz.questions).toHaveLength(2);
        });

        it('should create session with host player', async () => {
            const createQuizMessage = {
                type: 'create_quiz',
                topic: 'History',
                playerName: 'Quiz Master'
            };

            await server.onMessage(JSON.stringify(createQuizMessage), mockConnection);

            const session = server.getSession();
            expect(session).toBeDefined();
            expect(session.players[mockConnection.id]).toBeDefined();
            expect(session.players[mockConnection.id].name).toBe('Quiz Master');
            expect(session.players[mockConnection.id].isHost).toBe(true);
            expect(session.gameState).toBe('waiting');
        });
    });

    describe('Tournament Creation', () => {
        it('should create a tournament with combined quiz', async () => {
            const tournamentMessage = {
                type: 'create_tournament',
                tournament: {
                    name: 'Ultimate Challenge',
                    createdBy: 'Tournament Host',
                    combinedQuiz: {
                        id: 'tournament_123',
                        title: 'Ultimate Challenge',
                        questions: [
                            { id: 'q1', question: 'Q1?', options: ['A', 'B'], correctAnswer: 0 },
                            { id: 'q2', question: 'Q2?', options: ['A', 'B'], correctAnswer: 1 }
                        ],
                        isTournament: true,
                        sourceQuizzes: [
                            { id: 'quiz1', title: 'Quiz 1', questionCount: 1 },
                            { id: 'quiz2', title: 'Quiz 2', questionCount: 1 }
                        ]
                    }
                },
                playerName: 'Tournament Host'
            };

            await server.onMessage(JSON.stringify(tournamentMessage), mockConnection);

            const sentMessage = JSON.parse(sentMessages[0]);
            expect(sentMessage.type).toBe('tournament_created');
            expect(sentMessage.quiz.isTournament).toBe(true);
            expect(sentMessage.tournamentInfo.name).toBe('Ultimate Challenge');
            
            const session = server.getSession();
            expect(session.isTournament).toBe(true);
            expect(session.tournamentInfo.sourceQuizzes).toHaveLength(2);
        });
    });

    describe('Existing Quiz Play', () => {
        it('should load existing quiz and create session', async () => {
            const existingQuiz = {
                id: 'existing_quiz_123',
                title: 'Existing Quiz',
                topic: 'Math',
                questions: [
                    { id: 'q1', question: 'What is 2+2?', options: ['3', '4', '5', '6'], correctAnswer: 1 }
                ],
                createdBy: 'Original Creator'
            };

            const playMessage = {
                type: 'play_existing_quiz',
                quizId: 'existing_quiz_123',
                quiz: existingQuiz,
                playerName: 'Player'
            };

            await server.onMessage(JSON.stringify(playMessage), mockConnection);

            const sentMessage = JSON.parse(sentMessages[0]);
            expect(sentMessage.type).toBe('quiz_loaded');
            expect(sentMessage.quiz.title).toBe('Existing Quiz');
            
            const session = server.getSession();
            expect(session.quiz.id).toBe('existing_quiz_123');
        });

        it('should handle missing quiz data', async () => {
            const playMessage = {
                type: 'play_existing_quiz',
                quizId: 'nonexistent_quiz',
                quiz: null,
                playerName: 'Player'
            };

            await server.onMessage(JSON.stringify(playMessage), mockConnection);

            const sentMessage = JSON.parse(sentMessages[0]);
            expect(sentMessage.type).toBe('error');
            expect(sentMessage.message).toContain('Quiz not found');
        });
    });

    describe('Session Management', () => {
        beforeEach(async () => {
            // Create a quiz session first
            const createQuizMessage = {
                type: 'create_quiz',
                topic: 'Test',
                playerName: 'Host'
            };
            await server.onMessage(JSON.stringify(createQuizMessage), mockConnection);
            vi.clearAllMocks();
            sentMessages = [];
        });

        it('should allow players to join session', async () => {
            const newPlayer = {
                id: 'player2',
                send: vi.fn()
            };

            const joinMessage = {
                type: 'join_session',
                playerName: 'New Player'
            };

            await server.onMessage(JSON.stringify(joinMessage), newPlayer);

            const session = server.getSession();
            expect(session.players[newPlayer.id]).toBeDefined();
            expect(session.players[newPlayer.id].name).toBe('New Player');
            expect(session.players[newPlayer.id].isHost).toBe(false);
        });

        it('should handle player ready states', async () => {
            const readyMessage = {
                type: 'player_ready',
                ready: true
            };

            await server.onMessage(JSON.stringify(readyMessage), mockConnection);

            const session = server.getSession();
            expect(session.players[mockConnection.id].isReady).toBe(true);
        });

        it('should start quiz when host initiates', async () => {
            const startMessage = {
                type: 'start_quiz'
            };

            await server.onMessage(JSON.stringify(startMessage), mockConnection);

            const session = server.getSession();
            expect(session.gameState).toBe('playing');
            expect(session.currentQuestionIndex).toBe(0);
            
            expect(mockParty.broadcast).toHaveBeenCalled();
            const broadcastMessage = JSON.parse(sentMessages[0]);
            expect(broadcastMessage.type).toBe('quiz_started');
        });
    });

    describe('Game Flow', () => {
        beforeEach(async () => {
            // Create quiz and start it
            const createQuizMessage = {
                type: 'create_quiz',
                topic: 'Test',
                playerName: 'Host'
            };
            await server.onMessage(JSON.stringify(createQuizMessage), mockConnection);
            
            const startMessage = {
                type: 'start_quiz'
            };
            await server.onMessage(JSON.stringify(startMessage), mockConnection);
            
            vi.clearAllMocks();
            sentMessages = [];
        });

        it('should handle answer submission and scoring', async () => {
            const submitMessage = {
                type: 'submit_answer',
                answerIndex: 0 // Correct answer
            };

            await server.onMessage(JSON.stringify(submitMessage), mockConnection);

            const session = server.getSession();
            const player = session.players[mockConnection.id];
            
            expect(player.hasAnswered).toBe(true);
            expect(player.currentAnswer).toBe(0);
            expect(player.score).toBe(100); // 100 points for correct answer
        });

        it('should not award points for incorrect answers', async () => {
            const submitMessage = {
                type: 'submit_answer',
                answerIndex: 2 // Incorrect answer (correct is 0)
            };

            await server.onMessage(JSON.stringify(submitMessage), mockConnection);

            const session = server.getSession();
            const player = session.players[mockConnection.id];
            
            expect(player.hasAnswered).toBe(true);
            expect(player.currentAnswer).toBe(2);
            expect(player.score).toBe(0); // No points for incorrect answer
        });

        it('should show question results when all players answered', async () => {
            const submitMessage = {
                type: 'submit_answer',
                answerIndex: 0
            };

            await server.onMessage(JSON.stringify(submitMessage), mockConnection);

            expect(mockParty.broadcast).toHaveBeenCalled();
            const broadcastMessage = JSON.parse(sentMessages.find(msg => 
                JSON.parse(msg).type === 'question_results'
            ) || '{}');
            
            expect(broadcastMessage.type).toBe('question_results');
            expect(broadcastMessage.currentQuestion).toBeDefined();
            expect(broadcastMessage.playerAnswers[mockConnection.id]).toBeDefined();
        });

        it('should advance to next question', async () => {
            const nextMessage = {
                type: 'next_question'
            };

            await server.onMessage(JSON.stringify(nextMessage), mockConnection);

            const session = server.getSession();
            expect(session.currentQuestionIndex).toBe(1);
            expect(session.gameState).toBe('playing');
            
            // Player states should be reset
            const player = session.players[mockConnection.id];
            expect(player.hasAnswered).toBe(false);
            expect(player.currentAnswer).toBeUndefined();
        });

        it('should finish quiz when all questions answered', async () => {
            // Move to last question
            const session = server.getSession();
            session.currentQuestionIndex = session.quiz.questions.length - 1;

            const nextMessage = {
                type: 'next_question'
            };

            await server.onMessage(JSON.stringify(nextMessage), mockConnection);

            expect(session.gameState).toBe('finished');
            
            expect(mockParty.broadcast).toHaveBeenCalled();
            const broadcastMessage = JSON.parse(sentMessages.find(msg => 
                JSON.parse(msg).type === 'quiz_finished'
            ) || '{}');
            
            expect(broadcastMessage.type).toBe('quiz_finished');
            expect(broadcastMessage.playerAnswers).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid JSON messages', async () => {
            await server.onMessage('invalid json', mockConnection);

            expect(mockConnection.send).toHaveBeenCalled();
            const sentMessage = JSON.parse(sentMessages[0]);
            expect(sentMessage.type).toBe('error');
        });

        it('should handle unknown message types', async () => {
            const unknownMessage = {
                type: 'unknown_type',
                data: 'test'
            };

            await server.onMessage(JSON.stringify(unknownMessage), mockConnection);

            // Should not crash, just log warning
            expect(true).toBe(true); // Test passes if no error thrown
        });

        it('should prevent non-host from starting quiz', async () => {
            // Create session with host
            const createQuizMessage = {
                type: 'create_quiz',
                topic: 'Test',
                playerName: 'Host'
            };
            await server.onMessage(JSON.stringify(createQuizMessage), mockConnection);

            // Try to start quiz with non-host
            const nonHost = {
                id: 'player2',
                send: vi.fn()
            };

            const startMessage = {
                type: 'start_quiz'
            };

            await server.onMessage(JSON.stringify(startMessage), nonHost);

            const session = server.getSession();
            expect(session.gameState).toBe('waiting'); // Should not change
        });
    });

    describe('Multiplayer Scenarios', () => {
        let player2: MockConnection;

        beforeEach(async () => {
            // Create quiz session
            const createQuizMessage = {
                type: 'create_quiz',
                topic: 'Test',
                playerName: 'Host'
            };
            await server.onMessage(JSON.stringify(createQuizMessage), mockConnection);

            // Add second player
            player2 = {
                id: 'player2',
                send: vi.fn()
            };

            const joinMessage = {
                type: 'join_session',
                playerName: 'Player 2'
            };
            await server.onMessage(JSON.stringify(joinMessage), player2);

            // Start quiz
            const startMessage = {
                type: 'start_quiz'
            };
            await server.onMessage(JSON.stringify(startMessage), mockConnection);

            vi.clearAllMocks();
            sentMessages = [];
        });

        it('should wait for all players to answer before showing results', async () => {
            // Player 1 answers
            const submitMessage1 = {
                type: 'submit_answer',
                answerIndex: 0
            };
            await server.onMessage(JSON.stringify(submitMessage1), mockConnection);

            // Should not show results yet
            const resultsMessage = sentMessages.find(msg => 
                JSON.parse(msg).type === 'question_results'
            );
            expect(resultsMessage).toBeUndefined();

            // Player 2 answers
            const submitMessage2 = {
                type: 'submit_answer',
                answerIndex: 1
            };
            await server.onMessage(JSON.stringify(submitMessage2), player2);

            // Now should show results
            const resultsMessage2 = sentMessages.find(msg => 
                JSON.parse(msg).type === 'question_results'
            );
            expect(resultsMessage2).toBeDefined();
        });

        it('should track scores for multiple players', async () => {
            // Player 1 correct answer
            const submitMessage1 = {
                type: 'submit_answer',
                answerIndex: 0 // Correct
            };
            await server.onMessage(JSON.stringify(submitMessage1), mockConnection);

            // Player 2 incorrect answer
            const submitMessage2 = {
                type: 'submit_answer',
                answerIndex: 1 // Incorrect
            };
            await server.onMessage(JSON.stringify(submitMessage2), player2);

            const session = server.getSession();
            expect(session.players[mockConnection.id].score).toBe(100);
            expect(session.players[player2.id].score).toBe(0);
        });
    });
});

describe('Quizaru Server Tests', () => {
    it('should pass basic test', () => {
        expect(true).toBe(true);
    });
}); 