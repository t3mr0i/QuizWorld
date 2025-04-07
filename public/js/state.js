/**
 * state.js
 * Manages the shared client-side game state.
 */

// Game configuration - can be overridden by server on join
export const CATEGORIES = window.CATEGORIES || ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Tier', 'Pflanze'];

// Shared game state object
export const gameState = {
  playerName: '',
  roomId: '',
  isAdmin: false,
  adminId: null,
  currentLetter: '',
  submitted: false, // Has the current player submitted answers for the *current* round?
  timeLimit: 60,
  players: [], // Array of { id, name, score, isReady, submitted (server-confirmed) }
  timerInterval: null,
  // Add debugging fields
  lastSubmitTime: null,
  validationTimeoutId: null,
  categories: [...CATEGORIES], // Initial categories, can be updated by admin
  isReady: false, // Is the current player marked as ready?
  readyCount: 0,   // Count of ready players from server/socket messages
  clientSideMode: false, // Track if we're using client-side mode (e.g., for starting game)
  isConnected: false // Track WebSocket connection status
};

// Function to (re)initialize screen references (can be called from app.js init)
export function initializeScreenReferences() {
    console.log("Initializing screen references...");
    // Note: This might be better placed in dom.js if it only deals with DOM elements.
    // Assigning directly to window might be an anti-pattern with modules,
    // consider exporting/importing 'screens' from dom.js instead.
    window.screens = {
        welcome: document.getElementById('welcome-screen'),
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen'),
        results: document.getElementById('results-screen')
    };
     console.log("Screen references initialized:", window.screens);
}

// Make gameState globally accessible (optional, imports are preferred)
// window.gameState = gameState;
// window.CATEGORIES = CATEGORIES; 