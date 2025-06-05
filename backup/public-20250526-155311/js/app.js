/**
 * app.js
 * Main application entry point and initialization.
 */

// Import necessary functions and state from modules
import { gameState, initializeScreenReferences } from './state.js';
import { DOM, showScreen, showError } from './dom.js';
import { updateJoinButtonText, updatePlayerList, updateReadyStatus, displayRoundResults, updateScores } from './ui.js';
import { setupDynamicJoinButton, setupGameControls, initializeCategoryManagement } from './lobby.js';
import { submitAnswers } from './game.js';
// socket.js is loaded for its side effects (attaching listeners to window.gameSocket)
import './socket.js'; 

// Ensure socket is globally available (assuming partysocket.js loaded first)
const socket = window.gameSocket;

// Initialization Function
function init() {
  console.log('[app.js] Running init function...');

  try {
    // 1. Initialize references to screen elements
    // Moved initialization of screen constants to dom.js
    // initializeScreenReferences(); // Can be removed if screens are directly exported from dom.js

    // 2. Check for URL parameters (e.g., client-side mode override)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('all-start') || urlParams.has('allow-all')) {
      console.log('🔧 CLIENT-SIDE MODE: Enabled via URL parameter.');
      if (!window.CONFIG) window.CONFIG = {};
      window.CONFIG.ALLOW_ANYONE_TO_START = true;
      gameState.clientSideMode = true;
    }
    
    // Check for room ID in URL
    const roomParam = urlParams.get('room');
    if (roomParam) {
        const roomInput = DOM.get('room-id');
        if (roomInput) {
            roomInput.value = roomParam;
            // Update button text immediately if room ID found
            updateJoinButtonText();
        }
    }

    // 3. Set up initial UI elements and listeners
    setupDynamicJoinButton(); // Setup Join/Create button text toggle (lobby.js)
    updateJoinButtonText();   // Set initial text (ui.js)

    const joinGameBtn = DOM.get('join-game-btn');
    if (joinGameBtn) {
      joinGameBtn.onclick = handleJoinOrCreateClick; // Assign handler from this file
      console.log('[app.js] Join/Create button listener added.');
    }

    // Attach listener to the answers form submit event
    const answersForm = DOM.get('answers-form'); // Get the form element
    if (answersForm) {
      answersForm.addEventListener('submit', event => { // Attach listener to form
          event.preventDefault(); // Prevent default form submission
          submitAnswers(); // Call the handler from game.js
      });
      console.log('[app.js] Submit Answers listener added to form.');
    } else {
      console.warn('[app.js] Answers form (#answers-form) not found!');
    }
    
    // Setup time limit controls
    setupTimeLimitControls();

    // 4. WebSocket event handling is set up by importing socket.js

    // 5. Set up lobby-specific game controls (Ready, Start, Copy Link etc.)
    // These listeners are attached inside setupGameControls in lobby.js
    setupGameControls();
    console.log('[app.js] Lobby game controls setup initiated.');

    // 6. Show the initial screen (Welcome)
    showScreen('welcome');

    console.log('[app.js] App initialized successfully.');

  } catch (error) {
    console.error('[app.js] Error during app initialization:', error);
    showError(`Error initializing game: ${error.message}. Please refresh the page.`);
  }
}

// Handler for the main "Join Game" / "Create Game" button click
function handleJoinOrCreateClick() {
    console.log('[app.js] Join/Create button clicked');
    const joinGameBtn = DOM.get('join-game-btn');

    const playerNameInput = DOM.get('player-name');
    const roomIdInput = DOM.get('room-id');
    const timeLimitInput = DOM.get('time-limit');

    const playerName = playerNameInput?.value.trim() || '';
    const roomId = roomIdInput?.value.trim().toUpperCase() || '';
    const timeLimit = parseInt(timeLimitInput?.value, 10) || 60;

    if (!playerName) {
        showError('Please enter your name.');
        playerNameInput?.focus();
        return;
    }

    gameState.playerName = playerName;
    const isJoining = roomId !== '';
    gameState.roomId = isJoining ? roomId : generateRoomId();
    gameState.timeLimit = timeLimit;
    gameState.isAdmin = !isJoining;

    console.log(`[app.js] Attempting to ${isJoining ? 'join' : 'create'} room:`, {
        playerName: gameState.playerName, roomId: gameState.roomId, timeLimit: gameState.timeLimit, isAdminAttempt: gameState.isAdmin
    });

    if (joinGameBtn) {
        joinGameBtn.disabled = true;
        joinGameBtn.textContent = 'Connecting...';
    }

    try {
        // Use the globally available socket object
        if (!socket || typeof socket.connectToRoom !== 'function') {
            throw new Error("Socket connection method (connectToRoom) is not available.");
        }
        socket.connectToRoom(gameState.roomId, gameState.playerName, gameState.timeLimit);
        console.log(`[app.js] socket.connectToRoom called for ${gameState.roomId}`);

    } catch (error) {
        console.error('[app.js] Failed to initiate connection:', error);
        showError(`Failed to connect: ${error.message}. Please try again.`);
        if (joinGameBtn) {
            joinGameBtn.disabled = false;
            updateJoinButtonText(); // Reset text
        }
    }
}

// Setup listeners for time limit +/- buttons
function setupTimeLimitControls() {
    const decreaseBtn = DOM.query('.time-btn.decrease');
    const increaseBtn = DOM.query('.time-btn.increase');
    const timeInput = DOM.get('time-limit');

    if (decreaseBtn && increaseBtn && timeInput) {
        decreaseBtn.addEventListener('click', () => {
            let value = parseInt(timeInput.value, 10) || 60;
            value = Math.max(30, value - 10); // Min 30 seconds
            timeInput.value = value;
            gameState.timeLimit = value; // Update state if needed immediately
        });

        increaseBtn.addEventListener('click', () => {
            let value = parseInt(timeInput.value, 10) || 60;
            value = Math.min(300, value + 10); // Max 300 seconds
            timeInput.value = value;
            gameState.timeLimit = value; // Update state
        });
    }
}


// Helper function to generate a random room ID
function generateRoomId(length = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let roomId = '';
  for (let i = 0; i < length; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  console.log(`[app.js] Generated room ID: ${roomId}`);
  return roomId;
}

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('[app.js] DOM loaded, initializing application...');
  
  // Initialize socket and connection (handled in socket.js)
  
  // Set up UI event listeners
  init();
});

// Make functions accessible globally if needed (though imports are preferred)
// window.handleJoinOrCreateClick = handleJoinOrCreateClick;
// window.init = init; 

// Make key functions available globally for direct access in workarounds
window.displayRoundResults = displayRoundResults;
window.updateScores = updateScores; 