/**
 * socket.js
 * Handles WebSocket connection events and message routing.
 */

import { gameState } from './state.js';
import { DOM, showScreen, showError } from './dom.js';
import { updatePlayerList, updateScores, updateAdminControls, updateReadyStatus, displayRoundResults, updateButtonStates } from './ui.js';
import { initializeCategoryManagement, renderCategoryList } from './lobby.js';
import { setupCategoriesForm, startTimer, processLocalResults } from './game.js';

// ADDED: Log initial state
console.log('[socket.js] Initial check: window.gameSocket is:', window.gameSocket);

// Use the global socket from partysocket.js
// Ensure partysocket.js runs first and defines window.gameSocket
const socket = window.gameSocket;

// ADDED: Log assigned socket object
console.log("[socket.js] Assigned 'socket' variable to:", socket);
if (!socket || typeof socket.on !== 'function') {
    console.error("[socket.js] CRITICAL: window.gameSocket is not defined or invalid! Check script load order.");
    // Fallback to dummy to prevent immediate crash, but things won't work
    // const socket = createDummySocket(); // Avoid redefining const 'socket'
    showError("Game connection failed to initialize. Please refresh.");
    // No point setting up listeners on a potentially non-existent object
} else {
    // Only setup listeners if socket seems valid
    setupSocketEvents();
}

// Socket event handlers setup function (called once)
function setupSocketEvents() {
    console.log("[socket.js] Setting up socket event listeners...");

    // Check again inside setup, just in case
     if (!socket || typeof socket.on !== 'function') {
        console.error("[socket.js] setupSocketEvents called, but socket is invalid.");
        return;
    }

    // Remove potentially old listeners before adding new ones (PartySocket might not support 'off' easily)
    // We rely on setupSocketEvents being called only once.

    // Generic message handler
    socket.on('message', handleSocketMessage);
    console.log("[socket.js] Attached 'message' listener.");

    // Connection lifecycle events
    socket.on('connect', handleSocketConnect);
    console.log("[socket.js] Attached 'connect' listener.");

    socket.on('disconnect', handleSocketDisconnect);
    console.log("[socket.js] Attached 'disconnect' listener.");

    socket.on('error', handleSocketError);
    console.log("[socket.js] Attached 'error' listener.");

    console.log("[socket.js] Socket event listeners set up complete.");
}

// --- Connection Lifecycle Handlers ---

function handleSocketConnect() {
    // Socket ID might be available immediately or slightly later
    setTimeout(() => {
        socket.id = window.gameSocket?.id; // Ensure we get the ID
        console.log('[socket.js] Socket connected. ID:', socket.id || '(Unavailable)');

        // If reconnecting, try rejoining the room
        if (gameState.roomId && gameState.playerName && !gameState.isConnected) {
            console.log('[socket.js] Attempting to rejoin room after reconnecting:', gameState.roomId);
            if (typeof socket.connectToRoom === 'function') {
                socket.connectToRoom(gameState.roomId, gameState.playerName, gameState.timeLimit);
            } else {
                socket.send(JSON.stringify({ type: 'joinRoom', roomId: gameState.roomId, playerName: gameState.playerName, timeLimit: gameState.timeLimit, playerId: socket.id }));
            }
        }
        gameState.isConnected = true;
    }, 150); // Increased delay slightly
}

function handleSocketDisconnect() {
    console.log('[socket.js] Socket disconnected.');
    gameState.isConnected = false;
    showError('Disconnected from game server. Attempting to reconnect...');
    // Consider UI changes like disabling buttons or showing overlay
}

function handleSocketError(error) {
    console.error('[socket.js] Socket error:', error);
    const errorMessage = error?.message || (error instanceof Event ? 'Connection failed' : 'Unknown connection error');
    showError('Connection error: ' + errorMessage);
    // Connection might drop, handleDisconnect might be called separately by partysocket
}

// --- Main Message Handler --- 

function handleSocketMessage(data) {
    // ADDED: Log raw incoming data immediately
    console.log('[socket.js] RAW Incoming Data:', data);

    let message = data;
    if (typeof data === 'string') {
        try {
            message = JSON.parse(data);
        } catch (e) {
            console.error("[socket.js] Failed to parse incoming message string:", data, e);
            return;
        }
    }

    console.log('[socket.js] Received message object:', message);

    if (typeof message !== 'object' || !message.type) {
        console.warn("[socket.js] Received message without type or non-object:", message);
        return;
    }

    // --- ADDED: Specific check to ignore initial invalid 'joined' message ---
    if (message.type === 'joined' && (!message.roomId || !message.playerId)) {
        console.warn(`[socket.js] Ignoring likely initial connection confirmation message (type 'joined' without full details):`, message);
        return; // Stop processing this specific message type if incomplete
    }
    // --- END ADDED CHECK ---

    console.log(`[socket.js] Handling message type: ${message.type}`);

    // Clear client-side validation fallback timeout if active
    if (gameState.validationTimeoutId) {
        console.log('[socket.js] Received server message, clearing local validation timeout.');
        clearTimeout(gameState.validationTimeoutId);
        gameState.validationTimeoutId = null;
    }

    // Centralized error message handling
    if (message.type === 'error') {
        handleErrorMessage(message); // Use specific error handler below
        return;
    }

    // Dispatch to specific handlers based on message type
    const messageHandlers = {
        joinedRoom: handleJoinedRoom,
        playerJoined: handlePlayerJoined,
        playerLeft: handlePlayerLeft,
        playerReady: handlePlayerReady,
        categoriesUpdated: handleCategoriesUpdated,
        roundStarted: handleRoundStarted,
        roundResults: handleRoundResults,
        gameOver: handleGameOver,
        adminChanged: handleAdminChanged,
        stateSync: handleStateSync, // Added for full state sync
        // 'joined' might be deprecated if 'joinedRoom' is standard
        joined: handleJoinedRoom // Map 'joined' to 'joinedRoom' for compatibility
    };

    const handler = messageHandlers[message.type];
    if (handler) {
        try {
            handler(message);
        } catch (e) {
            console.error(`[socket.js] Error in handler for message type ${message.type}:`, e, message);
            showError(`An internal error occurred processing game update (${message.type}).`);
        }
    } else {
        console.log(`[socket.js] Unhandled message type: ${message.type}`);
    }
}

// --- Specific Message Handler Functions ---
// These functions update gameState and call UI functions from ui.js, game.js, etc.

function handleErrorMessage(data) {
  console.warn('[socket.js] Server error message:', data.message);
  const errorMessage = data.message || "An unknown error occurred.";

  // Handle specific errors like room full, name taken, etc.
  if (errorMessage.includes("Room not found") || errorMessage.includes("room full")) {
      showError(errorMessage + " Please check the Room ID or create a new game.");
      // Re-enable join button on welcome screen
      const joinBtn = DOM.get('join-game-btn');
      if (joinBtn) joinBtn.disabled = false;
      showScreen('welcome');
      return;
  }
  if (errorMessage.includes("Name is already taken")) {
      showError(errorMessage + " Please choose a different name.");
      const joinBtn = DOM.get('join-game-btn');
      if (joinBtn) joinBtn.disabled = false; // Re-enable button
      DOM.get('player-name')?.focus();
      // Don't switch screen, let user fix name on welcome screen
      return;
  }
  // Add more specific error handling as needed

  // Show generic server errors
  showError(`Server error: ${errorMessage}`);
}

function handleJoinedRoom(data) {
  console.log('[socket.js] Processing joinedRoom:', data);
  if (!data.roomId || !data.playerId) {
    console.error("[socket.js] Invalid joinedRoom message.", data);
    showError("Failed to join room (invalid data).");
    return;
  }

  // Update core state
  gameState.roomId = data.roomId;
  // Use existing name if reconnecting, otherwise use name from initial join attempt
  gameState.playerName = gameState.playerName || data.playerName || `Player_${data.playerId.substring(0, 4)}`;
  gameState.players = data.players || [];
  gameState.adminId = data.adminId || (gameState.players.length > 0 ? gameState.players[0].id : data.playerId);
  gameState.isAdmin = (window.gameSocket?.id === gameState.adminId);
  gameState.timeLimit = data.timeLimit || gameState.timeLimit || 60;
  gameState.categories = (data.categories && data.categories.length > 0) ? data.categories : gameState.categories;
  gameState.isConnected = true; // Mark as connected after joining

  // Ensure current player object exists in the list for isReady check
  const currentPlayer = gameState.players.find(p => p.id === window.gameSocket?.id);
  gameState.isReady = currentPlayer?.isReady || false;

  console.log("[socket.js] Updated gameState after joinedRoom:", {
      roomId: gameState.roomId, myId: window.gameSocket?.id, isAdmin: gameState.isAdmin, adminId: gameState.adminId
  });

  // Update UI elements
  const roomIdDisplay = DOM.get('display-room-id');
  if(roomIdDisplay) roomIdDisplay.textContent = gameState.roomId;
  
  updatePlayerList();
  initializeCategoryManagement(); // Initialize/render categories in lobby
  updateAdminControls();
  updateReadyStatus();

  // Transition to lobby screen
  showScreen('lobby');
  console.log("[socket.js] Successfully processed joined room.");
}

function handlePlayerJoined(data) {
  console.log('[socket.js] Processing playerJoined:', data);
  if (!data.player || !data.players) {
     console.warn("[socket.js] Invalid playerJoined message:", data);
     return;
  }
  gameState.players = data.players;
  // Re-check admin status in case admin left and rejoined? Unlikely but safe.
  // gameState.adminId = data.adminId || gameState.adminId;
  // gameState.isAdmin = (window.gameSocket?.id === gameState.adminId);
  updatePlayerList();
  updateReadyStatus(); // Update counts
}

function handlePlayerLeft(data) {
  console.log('[socket.js] Processing playerLeft:', data);
  if (!data.playerId || !data.players) {
     console.warn("[socket.js] Invalid playerLeft message:", data);
     return;
  }
  gameState.players = data.players;

  // Check if admin changed
  if (data.newAdminId && data.newAdminId !== gameState.adminId) {
    console.log(`[socket.js] Admin changed to: ${data.newAdminId}`);
    gameState.adminId = data.newAdminId;
    gameState.isAdmin = (window.gameSocket?.id === gameState.adminId);
    const newAdminPlayer = gameState.players.find(p => p.id === data.newAdminId);
    showError(`${newAdminPlayer?.name || 'A player'} is now the host.`);
  } else if (gameState.players.length > 0 && !gameState.players.some(p => p.id === gameState.adminId)) {
      // Handle case where admin left and server didn't assign a new one (fallback)
       console.warn("[socket.js] Current admin left, assigning first player as fallback.");
       gameState.adminId = gameState.players[0].id;
       gameState.isAdmin = (window.gameSocket?.id === gameState.adminId);
       // Maybe notify user? Might be confusing.
  }

  updatePlayerList();
  updateReadyStatus(); // Counts change
  updateAdminControls(); // Reflect potential admin change
}

function handlePlayerReady(data) {
  console.log('[socket.js] Processing playerReady:', data);
  if (!data.playerId || typeof data.isReady !== 'boolean') {
     console.warn("[socket.js] Invalid playerReady message:", data);
     return;
  }

  // Clear the fallback timeout if it exists - server has responded correctly
  if (gameState.readyFallbackTimeout) {
    console.log("[socket.js] Clearing fallback timeout - server responded to playerReady");
    clearTimeout(gameState.readyFallbackTimeout);
    gameState.readyFallbackTimeout = null;
  }

  const playerIndex = gameState.players.findIndex(p => p && p.id === data.playerId);
  if (playerIndex !== -1) {
      gameState.players[playerIndex].isReady = data.isReady;
      // If the message included the full updated player list, use it (good practice)
      if (Array.isArray(data.players)) {
          gameState.players = data.players;
      }
      // Update local convenience flag if it's the current player
      if (data.playerId === window.gameSocket?.id) {
          gameState.isReady = data.isReady;
      }
      // Recalculate ready count and update UI
      updateReadyStatus(); // This updates count and button states
      updatePlayerList(); // Update visual indicators in list
  } else {
      console.warn(`[socket.js] Received ready update for unknown player ID: ${data.playerId}`);
      // Optionally request full player list sync or use provided list if available
       if (Array.isArray(data.players)) {
           console.log("[socket.js] Syncing player list from ready message.");
           gameState.players = data.players;
           updateReadyStatus();
           updatePlayerList();
       }
  }
}

function handleCategoriesUpdated(data) {
  console.log('[socket.js] Processing categoriesUpdated:', data);
  if (!Array.isArray(data.categories)) {
    console.warn("[socket.js] Invalid categoriesUpdated message:", data);
    return;
  }
  gameState.categories = data.categories;
  // Re-render category list in lobby if currently visible
   if (DOM.get('lobby-screen')?.classList.contains('active')) {
        console.log("[socket.js] Updating lobby category list display.");
        renderCategoryList(); // from lobby.js
   }
}

function handleRoundStarted(data) {
  console.log('[socket.js] Processing roundStarted:', data);
  if (!data.letter || typeof data.timeLimit === 'undefined') { // Check timeLimit presence
     console.error("[socket.js] Invalid roundStarted message:", data);
     showError("Failed to start round (invalid data).");
     return;
  }

  // Clear fallback timeout if it exists - server has responded correctly
  if (gameState.startRoundFallbackTimeout) {
    console.log("[socket.js] Clearing fallback timeout - server responded to startRound");
    clearTimeout(gameState.startRoundFallbackTimeout);
    gameState.startRoundFallbackTimeout = null;
  }

  gameState.currentLetter = data.letter;
  gameState.submitted = false; // Reset submission status for the new round
  gameState.timeLimit = data.timeLimit;
  // Update categories if server sent them (good practice)
  if (Array.isArray(data.categories) && data.categories.length > 0) {
      gameState.categories = data.categories;
  }

  // Clear submitted status for all players locally for UI update
  gameState.players.forEach(p => p.submitted = false);

  // Update UI
  setupCategoriesForm(data.letter); // Setup game form (game.js)
  startTimer(data.timeLimit);       // Start timer (game.js)
  updatePlayerList(); // Clear any 'submitted' badges from previous round
  showScreen('game');               // Switch to game screen (dom.js)

  console.log("[socket.js] Game screen setup, timer started.");
}

function handleRoundResults(data) {
  console.log('[socket.js] Processing roundResults:', data);
  if (!data.scores || !data.players || !data.categories) {
      console.error("[socket.js] Invalid roundResults message.", data);
      showError("Failed to display results (invalid data).");
      return;
  }

  // Stop the timer if it's somehow still running
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = null;
  }
  // Clear any pending client-side validation timeout
   if (gameState.validationTimeoutId) {
    clearTimeout(gameState.validationTimeoutId);
    gameState.validationTimeoutId = null;
  }

  // Update player total scores in gameState based on received data
   gameState.players.forEach(localPlayer => {
       const serverPlayer = data.players.find(sp => sp.id === localPlayer.id);
       if (serverPlayer) {
           localPlayer.score = serverPlayer.score || 0; // Update total score
       }
   });

  // Display the results table and updated scores
  displayRoundResults(data); // from ui.js

  // Switch to results screen
  showScreen('results');
}

function handleGameOver(data) {
    console.log('[socket.js] Processing gameOver:', data);
    if (!Array.isArray(data.players)) {
         console.warn("[socket.js] Invalid gameOver message.", data);
         showError("Game over, but final scores are missing.");
         showScreen('results'); // Show last results screen anyway?
         return;
    }

    console.log("[socket.js] Game Over! Reason:", data.reason || "Not specified");

    // Stop timer if running
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    gameState.timerInterval = null;

    // Update final scores in gameState
    gameState.players = data.players;

    // Update UI: Show final scores on the results screen
     const resultsTitle = DOM.get('results-title');
     if(resultsTitle) resultsTitle.textContent = 'Final Results';

     updateScores(); // Update the scores list (ui.js)

    // Modify "Next Round" button to "Play Again" or similar
    const nextRoundBtn = DOM.get('next-round-btn');
    if (nextRoundBtn) {
        nextRoundBtn.textContent = 'Play Again';
        // Logic for Play Again is handled in setupGameControls in lobby.js
        // Ensure it's enabled appropriately
        nextRoundBtn.disabled = false; // Always allow going back to lobby?
    }

    showScreen('results'); // Ensure results screen is shown
}

function handleAdminChanged(data) {
     console.log('[socket.js] Processing adminChanged:', data);
     if (!data.newAdminId) {
         console.warn("[socket.js] Invalid adminChanged message.", data);
         return;
     }
     if (data.newAdminId !== gameState.adminId) {
         const oldAdminId = gameState.adminId;
         gameState.adminId = data.newAdminId;
         gameState.isAdmin = (window.gameSocket?.id === gameState.adminId);
         const newAdminPlayer = gameState.players.find(p => p.id === data.newAdminId);
         console.log(`[socket.js] Admin changed from ${oldAdminId} to ${data.newAdminId}. Is current player admin: ${gameState.isAdmin}`);

          // Update UI immediately
         updateAdminControls();
         updatePlayerList();
         updateButtonStates();

          // Notify user
         if (gameState.isAdmin) {
            showError("You are now the host!"); // Use error for notification style
         } else {
             showError(`${newAdminPlayer?.name || 'Another player'} is now the host.`);
         }
     }
}

function handleStateSync(data) {
    console.log('[socket.js] Processing stateSync:', data);
    // Overwrite relevant parts of local state with server state
    // Be careful not to overwrite everything if some state is purely local
    if (data.roomId) gameState.roomId = data.roomId;
    if (data.players) gameState.players = data.players;
    if (data.adminId) {
         gameState.adminId = data.adminId;
         gameState.isAdmin = (window.gameSocket?.id === gameState.adminId);
    }
    if (data.categories) gameState.categories = data.categories;
    if (typeof data.timeLimit !== 'undefined') gameState.timeLimit = data.timeLimit;
    if (data.currentLetter) gameState.currentLetter = data.currentLetter; // Sync if game in progress?
    // Potentially sync readyCount, etc.
    if (typeof data.readyCount !== 'undefined') gameState.readyCount = data.readyCount;

    // Re-initialize UI based on synced state
    console.log("[socket.js] State synced, updating UI...");
    updatePlayerList();
    renderCategoryList(); // Use render instead of init?
    updateAdminControls();
    updateReadyStatus();
    // Potentially update timer, game form if state indicates game is active
    if (gameState.currentLetter) {
        console.log("[socket.js] State sync indicates game in progress, updating game UI.");
        setupCategoriesForm(gameState.currentLetter);
        // Server should ideally send remaining time for timer sync
        // startTimer(data.remainingTime || gameState.timeLimit);
        showScreen('game');
    } else if (gameState.roomId) {
         console.log("[socket.js] State sync indicates in lobby.");
         showScreen('lobby');
    } else {
         console.log("[socket.js] State sync indicates back at welcome.");
         showScreen('welcome');
    }
}

// Dummy socket creation (only used if window.gameSocket fails)
/*
function createDummySocket() { ... } // Keep definition but hopefully unused
*/