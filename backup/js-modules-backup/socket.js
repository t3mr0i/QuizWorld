/**
 * socket.js
 * Handles WebSocket connection events and message routing.
 */

import { gameState } from './state.js';
import { DOM, showScreen, showError } from './dom.js';
import { updatePlayerList, updateScores, updateAdminControls, updateReadyStatus, displayRoundResults, updateButtonStates } from './ui.js';
import { initializeCategoryManagement } from './lobby.js';
import { setupCategoriesForm, startTimer, processLocalResults, handleTimerReduction } from './game.js';

// Use the global socket from partysocket.js
const socket = window.gameSocket;

console.log('[socket.js] Initializing socket handlers');

if (!socket || typeof socket.on !== 'function') {
    console.error('[socket.js] CRITICAL: window.gameSocket is not defined or invalid!');
    showError('Game connection failed to initialize. Please refresh.');
} else {
    setupSocketEvents();
}

/**
 * Sets up all socket event listeners
 */
function setupSocketEvents() {
    console.log('[socket.js] Setting up socket event listeners');

    if (!socket || typeof socket.on !== 'function') {
        console.error('[socket.js] Cannot setup events: socket is invalid');
        return;
    }

    // Main message handler
    socket.on('message', handleSocketMessage);
    
    // Connection lifecycle events
    socket.on('connect', handleSocketConnect);
    socket.on('disconnect', handleSocketDisconnect);
    socket.on('error', handleSocketError);

    console.log('[socket.js] Socket event listeners configured');
}

/**
 * Handles socket connection
 */
function handleSocketConnect() {
    const checkConnectionInterval = setInterval(() => {
        if (window.gameSocket?.id) {
            clearInterval(checkConnectionInterval);
            socket.id = window.gameSocket.id;
            console.log('[socket.js] Socket connected with ID:', socket.id);
            gameState.isConnected = true;

            // Send join room message
            if (gameState.playerName) {
                const joinMessage = {
                    type: 'joinRoom',
                    playerName: gameState.playerName,
                    timeLimit: gameState.timeLimit
                };
                
                if (gameState.roomId) {
                    joinMessage.roomId = gameState.roomId;
                }
                
                console.log('[socket.js] Sending joinRoom message:', joinMessage);
                socket.send(JSON.stringify(joinMessage));
            } else {
                console.error('[socket.js] Cannot join: playerName missing');
                showError('Failed to join room: Player name missing');
            }
        }
    }, 100);

    // Connection timeout
    setTimeout(() => {
        if (!gameState.isConnected) {
            clearInterval(checkConnectionInterval);
            console.error('[socket.js] Connection timeout');
            showError('Connection timed out. Please try again.');
        }
    }, 5000);
}

/**
 * Handles socket disconnection
 */
function handleSocketDisconnect() {
    console.log('[socket.js] Socket disconnected');
    gameState.isConnected = false;
    showError('Disconnected from game server. Attempting to reconnect...');
}

/**
 * Handles socket errors
 */
function handleSocketError(error) {
    console.error('[socket.js] Socket error:', error);
    const errorMessage = error?.message || 'Connection error';
    showError('Connection error: ' + errorMessage);
}

/**
 * Main message handler - routes messages to specific handlers
 */
function handleSocketMessage(data) {
    console.log('[socket.js] Received message:', data);

    let message = data;
    if (typeof data === 'string') {
        try {
            message = JSON.parse(data);
        } catch (e) {
            console.error('[socket.js] Failed to parse message:', data, e);
            return;
        }
    }

    if (typeof message !== 'object' || !message.type) {
        console.warn('[socket.js] Invalid message format:', message);
        return;
    }

    // Ignore incomplete initial messages
    if (message.type === 'joined' && (!message.roomId || !message.playerId)) {
        console.warn('[socket.js] Ignoring incomplete joined message:', message);
        return;
    }

    // Clear validation timeout if active
    if (gameState.validationTimeoutId) {
        clearTimeout(gameState.validationTimeoutId);
        gameState.validationTimeoutId = null;
    }

    // Route to specific handlers
    const messageHandlers = {
        'connection': handleSocketConnect,
        'joined': handleJoinedRoom,
        'joinedRoom': handleJoinedRoom, // PartyKit format
        'playerJoined': handlePlayerJoined,
        'playerLeft': handlePlayerLeft,
        'player-ready-update': handlePlayerReady, // PartyKit format
        'categoriesUpdated': handleCategoriesUpdated,
        'roundStarted': handleRoundStarted,
        'roundResults': handleRoundResults,
        'gameOver': handleGameOver,
        'adminChanged': handleAdminChanged,
        'stateSync': handleStateSync,
        'submission-ack': handleSubmissionAcknowledgment,
        'playerSubmitted': handlePlayerSubmitted,
        'sessionClosed': handleSessionClosed,
        'echo-response': handleEchoResponse,
        'timerReduced': handleTimerReduced,
        'error': handleErrorMessage
    };

    const handler = messageHandlers[message.type];
    if (handler) {
        try {
            handler(message);
        } catch (error) {
            console.error(`[socket.js] Error handling ${message.type}:`, error);
        }
    } else {
        console.warn('[socket.js] Unknown message type:', message.type);
    }
}

/**
 * Handles error messages from server
 */
function handleErrorMessage(data) {
    console.error('[socket.js] Server error:', data);
    const errorMessage = data.message || data.error || 'Unknown server error';
    
    // Handle specific errors
    if (errorMessage.includes('Room not found') || errorMessage.includes('room full')) {
        showError(errorMessage + ' Please check the Room ID or create a new game.');
        const joinBtn = DOM.get('join-game-btn');
        if (joinBtn) joinBtn.disabled = false;
        showScreen('welcome');
        return;
    }
    
    if (errorMessage.includes('Name is already taken')) {
        showError(errorMessage + ' Please choose a different name.');
        const joinBtn = DOM.get('join-game-btn');
        if (joinBtn) joinBtn.disabled = false;
        DOM.get('player-name')?.focus();
        return;
    }
    
    showError(`Server error: ${errorMessage}`);
}

/**
 * Handles successful room join
 */
function handleJoinedRoom(data) {
    console.log('[socket.js] Joined room:', data);
    
    if (!data.roomId || !data.playerId) {
        console.error('[socket.js] Invalid joinedRoom data:', data);
        return;
    }

    // Update game state
    gameState.roomId = data.roomId;
    gameState.isAdmin = data.isAdmin || false;
    gameState.adminId = data.adminId;
    
    if (Array.isArray(data.players)) {
        gameState.players = data.players;
    }
    
    if (Array.isArray(data.categories)) {
        gameState.categories = data.categories;
    }
    
    if (typeof data.timeLimit === 'number') {
        gameState.timeLimit = data.timeLimit;
    }

    // Update current player's ready status
    const currentPlayer = gameState.players.find(p => p.id === window.gameSocket?.id);
    gameState.isReady = currentPlayer?.isReady || false;

    // Update UI
    const roomIdDisplay = DOM.get('display-room-id');
    if (roomIdDisplay) roomIdDisplay.textContent = gameState.roomId;
    
    updatePlayerList();
    updateAdminControls();
    updateReadyStatus();
    initializeCategoryManagement();
    showScreen('lobby');
    
    console.log('[socket.js] Room join complete, lobby displayed');
}

/**
 * Handles player joined notifications
 */
function handlePlayerJoined(data) {
    console.log('[socket.js] Player joined:', data);
    
    if (Array.isArray(data.players)) {
        gameState.players = data.players;
        updatePlayerList();
        updateReadyStatus();
    }
}

/**
 * Handles player left notifications
 */
function handlePlayerLeft(data) {
    console.log('[socket.js] Player left:', data);
    
    if (Array.isArray(data.players)) {
        gameState.players = data.players;
        updatePlayerList();
        updateReadyStatus();
    }
    
    // Handle admin change
    if (data.newAdminId && data.newAdminId !== gameState.adminId) {
        console.log(`[socket.js] Admin changed to: ${data.newAdminId}`);
        gameState.adminId = data.newAdminId;
        gameState.isAdmin = data.newAdminId === window.gameSocket?.id;
        
        const newAdminPlayer = gameState.players.find(p => p.id === data.newAdminId);
        const message = gameState.isAdmin ? 
            'You are now the host!' : 
            `${newAdminPlayer?.name || 'A player'} is now the host.`;
        showError(message);
        
        updateAdminControls();
    }
}

/**
 * Handles player ready status updates - simplified and unified
 */
function handlePlayerReady(data) {
    console.log('[socket.js] Player ready update received:', data);

    // Handle both PartyKit and standard formats
    if (data.type === 'player-ready-update' || Array.isArray(data.players)) {
        // Full player list update from server
        if (Array.isArray(data.players)) {
            console.log('[socket.js] Updating full player list from server');
            gameState.players = data.players;
        }
        
        if (typeof data.readyCount === 'number') {
            gameState.readyCount = data.readyCount;
            console.log(`[socket.js] Server ready count: ${data.readyCount}`);
        }
    } else if (data.playerId && typeof data.isReady === 'boolean') {
        // Individual player update
        console.log(`[socket.js] Individual player update: ${data.playerId} -> ${data.isReady}`);
        const playerIndex = gameState.players.findIndex(p => p && p.id === data.playerId);
        if (playerIndex !== -1) {
            gameState.players[playerIndex].isReady = data.isReady;
            console.log(`[socket.js] Updated player ${data.playerId} ready status to ${data.isReady}`);
        } else {
            console.warn(`[socket.js] Player ${data.playerId} not found in local player list`);
        }
    } else {
        console.warn('[socket.js] Invalid playerReady message format:', data);
        return;
    }

    // Update current player's ready status from the updated player list
    const currentSocketId = window.gameSocket?.id;
    const currentPlayer = gameState.players.find(p => p && p.id === currentSocketId);
    if (currentPlayer) {
        const oldReadyState = gameState.isReady;
        gameState.isReady = currentPlayer.isReady || false;
        console.log(`[socket.js] Current player ready status: ${oldReadyState} -> ${gameState.isReady}`);
    }

    // Update UI components
    console.log('[socket.js] Updating UI after ready status change');
    updatePlayerList();
    updateReadyStatus();
    updateButtonStates();
}

/**
 * Handles category updates
 */
function handleCategoriesUpdated(data) {
    console.log('[socket.js] Categories updated:', data);
    
    if (!Array.isArray(data.categories)) {
        console.warn('[socket.js] Invalid categoriesUpdated message:', data);
        return;
    }
    
    gameState.categories = data.categories;
    
    // Update lobby display if active
    if (DOM.get('lobby-screen')?.classList.contains('active')) {
        initializeCategoryManagement();
    }
}

/**
 * Handles round start
 */
function handleRoundStarted(data) {
    console.log('[socket.js] Round started:', data);
    
    if (!data.letter || typeof data.timeLimit === 'undefined') {
        console.error('[socket.js] Invalid roundStarted message:', data);
        showError('Failed to start round (invalid data)');
        return;
    }

    // Update game state
    gameState.currentLetter = data.letter;
    gameState.submitted = false;
    gameState.timeLimit = data.timeLimit;
    
    if (Array.isArray(data.categories)) {
        gameState.categories = data.categories;
    }

    // Clear submitted status for all players
    gameState.players.forEach(p => p.submitted = false);

    // Setup game UI
    setupCategoriesForm(data.letter);
    startTimer(data.timeLimit);
    updatePlayerList();
    showScreen('game');
    
    console.log('[socket.js] Game round started successfully');
}

/**
 * Handles round results
 */
function handleRoundResults(data) {
    console.log('[socket.js] Round results received:', data);
    
    if (!data.scores || !data.players || !data.categories) {
        console.error('[socket.js] Invalid roundResults message:', data);
        showError('Failed to display results (invalid data)');
        return;
    }

    // Stop timer and clear timeouts
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
    
    if (gameState.validationTimeoutId) {
        clearTimeout(gameState.validationTimeoutId);
        gameState.validationTimeoutId = null;
    }

    // Update player scores
    gameState.players.forEach(localPlayer => {
        const serverPlayer = data.players.find(sp => sp.id === localPlayer.id);
        if (serverPlayer) {
            localPlayer.score = serverPlayer.score || 0;
        }
    });

    // Display results
    displayRoundResults(data);
    showScreen('results');
}

/**
 * Handles game over
 */
function handleGameOver(data) {
    console.log('[socket.js] Game over:', data);
    
    if (!Array.isArray(data.players)) {
        console.warn('[socket.js] Invalid gameOver message:', data);
        showError('Game over, but final scores are missing');
        showScreen('results');
        return;
    }

    // Stop timer
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }

    // Update final scores
    gameState.players = data.players;

    // Update UI for game over
    const resultsTitle = DOM.get('results-title');
    if (resultsTitle) resultsTitle.textContent = 'Final Results';

    const nextRoundBtn = DOM.get('next-round-btn');
    if (nextRoundBtn) {
        nextRoundBtn.textContent = 'Play Again';
        nextRoundBtn.disabled = false;
    }

    updateScores();
    showScreen('results');
}

/**
 * Handles admin change notifications
 */
function handleAdminChanged(data) {
    console.log('[socket.js] Admin changed:', data);
    
    if (!data.newAdminId || data.newAdminId === gameState.adminId) {
        return;
    }
    
    const oldAdminId = gameState.adminId;
    gameState.adminId = data.newAdminId;
    gameState.isAdmin = data.newAdminId === window.gameSocket?.id;
    
    const newAdminPlayer = gameState.players.find(p => p.id === data.newAdminId);
    console.log(`[socket.js] Admin changed from ${oldAdminId} to ${data.newAdminId}`);

    // Update UI
    updateAdminControls();
    updatePlayerList();
    updateButtonStates();

    // Notify user
    const message = gameState.isAdmin ? 
        'You are now the host!' : 
        `${newAdminPlayer?.name || 'Another player'} is now the host.`;
    showError(message);
}

/**
 * Handles full state synchronization
 */
function handleStateSync(data) {
    console.log('[socket.js] State sync received:', data);
    
    // Update all relevant state
    if (data.roomId) gameState.roomId = data.roomId;
    if (typeof data.isAdmin === 'boolean') gameState.isAdmin = data.isAdmin;
    if (data.adminId) gameState.adminId = data.adminId;
    if (data.currentLetter) gameState.currentLetter = data.currentLetter;
    if (typeof data.timeLimit === 'number') gameState.timeLimit = data.timeLimit;
    if (Array.isArray(data.players)) gameState.players = data.players;
    if (Array.isArray(data.categories)) gameState.categories = data.categories;
    if (typeof data.readyCount === 'number') gameState.readyCount = data.readyCount;
    
    // Update current player's ready status
    const currentPlayer = gameState.players.find(p => p?.id === window.gameSocket?.id);
    if (currentPlayer) {
        gameState.isReady = currentPlayer.isReady || false;
    }

    // Update all UI components
    updatePlayerList();
    updateAdminControls();
    updateReadyStatus();
    
    if (DOM.get('lobby-screen')?.classList.contains('active')) {
        initializeCategoryManagement();
    }

    // Navigate to appropriate screen
    if (gameState.currentLetter) {
        setupCategoriesForm(gameState.currentLetter);
        showScreen('game');
    } else if (gameState.roomId) {
        showScreen('lobby');
    } else {
        showScreen('welcome');
    }
}

/**
 * Handles submission acknowledgments
 */
function handleSubmissionAcknowledgment(data) {
    console.log('[socket.js] Submission acknowledged:', data);
    
    // Clear validation timeout
    if (gameState.validationTimeoutId) {
        clearTimeout(gameState.validationTimeoutId);
        gameState.validationTimeoutId = null;
    }
    
    // Update UI
    const submitBtn = DOM.get('submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Answers Received ✓';
        submitBtn.classList.add('btn-success');
        submitBtn.classList.remove('btn-primary');
    }
    
    // Update state
    gameState.submitted = true;
    gameState.submissionAcknowledged = true;
    
    console.log('[socket.js] Submission successfully acknowledged');
}

/**
 * Handles player submission notifications
 */
function handlePlayerSubmitted(data) {
    console.log('[socket.js] Player submitted:', data);
    
    // Update submission status display
    const submissionStatusEl = DOM.get('submission-status');
    if (submissionStatusEl && data.submittedCount && data.totalPlayers) {
        submissionStatusEl.textContent = `${data.submittedCount}/${data.totalPlayers} players submitted`;
        submissionStatusEl.style.display = 'block';
    }
    
    // Update player's submitted status
    if (data.playerId) {
        const player = gameState.players.find(p => p?.id === data.playerId);
        if (player) {
            player.submitted = true;
            updatePlayerList();
        }
    }
}

/**
 * Handles session closed by host
 */
function handleSessionClosed(data) {
    console.log('[socket.js] Session closed by host:', data);
    
    const reason = data.reason || 'Session closed';
    const message = data.message || 'The session has been closed.';
    
    // Clear game state
    gameState.players = [];
    gameState.isAdmin = false;
    gameState.adminId = '';
    gameState.roomId = '';
    gameState.isReady = false;
    gameState.currentLetter = '';
    gameState.submitted = false;
    
    // Stop any running timers
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
    
    if (gameState.validationTimeoutId) {
        clearTimeout(gameState.validationTimeoutId);
        gameState.validationTimeoutId = null;
    }
    
    // Show welcome screen
    showScreen('welcome');
    
    // Show notification to user
    showError(`Session Closed: ${message}`);
    
    // Close the socket connection
    setTimeout(() => {
        if (window.gameSocket) {
            window.gameSocket.close();
        }
    }, 1000);
    
    console.log('[socket.js] Session closed handling complete');
}

/**
 * Handles echo response for testing
 */
function handleEchoResponse(data) {
    console.log('[socket.js] Echo response:', data);
    
    const statusDiv = document.createElement('div');
    statusDiv.className = 'connection-test';
    statusDiv.style.cssText = `
        padding: 10px; margin: 10px; background-color: #eaffea; 
        border: 1px solid #88d688; border-radius: 4px;
    `;
    statusDiv.innerHTML = `
        <h4>Connection Test Successful! ✓</h4>
        <p>Message: ${data.originalMessage}</p>
        <p>Round-trip time: ${Date.now() - new Date(data.receivedAt).getTime()}ms</p>
    `;
    
    document.body.insertBefore(statusDiv, document.body.firstChild);
    
    // Remove after 5 seconds
    setTimeout(() => {
        if (document.body.contains(statusDiv)) {
            document.body.removeChild(statusDiv);
        }
    }, 5000);
}

/**
 * Handles timer reduction notifications from server
 */
function handleTimerReduced(data) {
    console.log('[socket.js] Timer reduction received:', data);
    
    // Call the timer reduction handler from game.js
    handleTimerReduction(data);
}