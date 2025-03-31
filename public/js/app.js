// Connect to Socket.IO server
// Since we're ensuring Socket.IO is loaded before this script runs,
// we can directly establish the connection
console.log('Connecting to Socket.IO server');

// Connect with path option to ensure compatibility with Vercel deployment
const socket = io({
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

// DOM Elements
// Screens
const welcomeScreen = document.getElementById('welcome-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const resultsScreen = document.getElementById('results-screen');

// Welcome Screen
const playerNameInput = document.getElementById('player-name');
const roomIdInput = document.getElementById('room-id');
const timeLimitInput = document.getElementById('time-limit');
const joinBtn = document.getElementById('join-btn');

// Lobby Screen
const lobbyRoomId = document.getElementById('lobby-room-id');
const lobbyTimeLimit = document.getElementById('lobby-time-limit');
const playerList = document.getElementById('player-list');
const startGameBtn = document.getElementById('start-game-btn');

// Game Screen
const currentLetterDisplay = document.getElementById('current-letter');
const timeRemainingDisplay = document.getElementById('time-remaining');
const progressFill = document.querySelector('.progress-fill');
const readyPlayersDisplay = document.getElementById('ready-players');
const totalPlayersDisplay = document.getElementById('total-players');
const answersForm = document.getElementById('answers-form');
const submitAnswersBtn = document.getElementById('submit-answers-btn');
const answerInputs = document.querySelectorAll('.answer-input');

// Results Screen
const roundResultsContainer = document.getElementById('round-results');
const scoreList = document.getElementById('score-list');
const nextRoundBtn = document.getElementById('next-round-btn');

// Loading Overlay
const loadingOverlay = document.getElementById('loading-overlay');

// Player Status Modal
const playerStatusModal = document.getElementById('player-status-modal');
const closeModalBtn = document.querySelector('.close-modal');
const detailedPlayerStatus = document.getElementById('detailed-player-status');

// Game state
let gameState = {
  playerName: '',
  roomId: '',
  isAdmin: false,
  adminId: null,
  currentLetter: null,
  submitted: false,
  timeLimit: 60,
  timer: null,
  players: [],
  timerInterval: null
};

// Helper functions
function showScreen(screenId) {
  // Hide all screens
  [welcomeScreen, lobbyScreen, gameScreen, resultsScreen].forEach(screen => {
    screen.classList.remove('active');
  });
  
  // Show requested screen
  document.getElementById(screenId).classList.add('active');
  
  // Special handling for lobby screen
  if (screenId === 'lobby-screen') {
    // Check visibility of admin controls after the screen is shown
    setTimeout(checkAdminControlsVisibility, 500);
  }
}

function showLoading(show) {
  if (show) {
    loadingOverlay.classList.add('active');
  } else {
    loadingOverlay.classList.remove('active');
  }
}

function showPlayerStatusModal() {
  updateDetailedPlayerStatus();
  playerStatusModal.classList.add('active');
}

function hidePlayerStatusModal() {
  playerStatusModal.classList.remove('active');
}

function updateDetailedPlayerStatus() {
  let html = '';
  
  gameState.players.forEach(player => {
    html += `
      <div class="player-detail">
        <div>
          ${player.name}${player.id === socket.id ? ' (You)' : ''}
        </div>
        <div>
          ${gameState.isAdmin && player.id === socket.id ? 
            '<span class="status-badge admin">Admin</span>' : ''}
        </div>
      </div>
    `;
  });
  
  detailedPlayerStatus.innerHTML = html;
}

function updatePlayerList() {
  // Clear player list
  playerList.innerHTML = '';
  
  // Log players to console for debugging
  console.log('Updating player list with players:', gameState.players);
  
  // Sort players to ensure consistent order (admins first, then alphabetically)
  const sortedPlayers = [...gameState.players].sort((a, b) => {
    // Admin first
    if (a.id === socket.id && gameState.isAdmin) return -1;
    if (b.id === socket.id && gameState.isAdmin) return 1;
    // Then current player
    if (a.id === socket.id) return -1;
    if (b.id === socket.id) return 1;
    // Then alphabetically by name
    return a.name.localeCompare(b.name);
  });
  
  // Add each player to the list
  sortedPlayers.forEach(player => {
    const listItem = document.createElement('li');
    
    // Create status indicator
    const statusIndicator = document.createElement('span');
    statusIndicator.classList.add('player-status-indicator');
    
    // Always show player as online/active status
    statusIndicator.classList.add('status-online');
    
    // Create player name text
    const playerName = document.createElement('span');
    playerName.textContent = player.name + (player.id === socket.id ? ' (You)' : '');
    
    // Add admin indicator if applicable
    const isAdmin = player.isAdmin || (gameState.adminId && player.id === gameState.adminId);
    if (isAdmin) {
      const adminIndicator = document.createElement('span');
      adminIndicator.classList.add('player-status-indicator', 'status-admin');
      adminIndicator.style.marginLeft = '8px';
      playerName.appendChild(adminIndicator);
      playerName.appendChild(document.createTextNode(' (Admin)'));
    }
    
    // Add elements to list item
    listItem.appendChild(statusIndicator);
    listItem.appendChild(playerName);
    
    // Make the list item clickable to show detailed status
    listItem.style.cursor = 'pointer';
    listItem.addEventListener('click', showPlayerStatusModal);
    
    playerList.appendChild(listItem);
  });
  
  // Ensure the admin-controls div is visible and only toggle the button's visibility
  document.getElementById('admin-controls').style.display = 'block';
  
  // Force inline-block style for the Start Game button if admin
  if (gameState.isAdmin) {
    startGameBtn.style.display = 'inline-block';
    console.log('Setting Start Game button to visible (inline-block)');
    
    // Add an !important flag with setAttribute to override any potential CSS issues
    startGameBtn.setAttribute('style', 'display: inline-block !important');
  } else {
    startGameBtn.style.display = 'none';
    console.log('Setting Start Game button to hidden (none)');
  }
  
  console.log("Start Game button display:", startGameBtn.style.display, "isAdmin:", gameState.isAdmin);
  
  // Add debug info directly to DOM if admin
  if (gameState.isAdmin) {
    // Remove any existing debug info
    const existingInfo = document.getElementById('admin-debug-info');
    if (existingInfo) {
      existingInfo.remove();
    }
    
    const adminInfo = document.createElement('p');
    adminInfo.id = 'admin-debug-info';
    adminInfo.textContent = 'You are the admin and can start the game anytime.';
    adminInfo.style.color = '#FF4600';
    adminInfo.style.fontWeight = 'bold';
    adminInfo.style.marginTop = '10px';
    document.getElementById('admin-controls').appendChild(adminInfo);
  }
  
  // Update player count in game screen
  totalPlayersDisplay.textContent = gameState.players.length;
  // No need for ready players display anymore
  if (readyPlayersDisplay) {
    readyPlayersDisplay.parentElement.innerHTML = `<h3>Players: <span id="total-players">${gameState.players.length}</span></h3>`;
  }
}

function startTimer(seconds) {
  // Clear any existing timer
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }
  
  let timeRemaining = seconds;
  updateTimerDisplay(timeRemaining, seconds);
  
  gameState.timerInterval = setInterval(() => {
    timeRemaining--;
    updateTimerDisplay(timeRemaining, seconds);
    
    if (timeRemaining <= 0) {
      clearInterval(gameState.timerInterval);
      
      // Auto-submit if not already submitted
      if (!gameState.submitted) {
        submitAnswers();
      }
    }
  }, 1000);
}

function updateTimerDisplay(timeRemaining, totalTime) {
  // Update text display
  timeRemainingDisplay.textContent = timeRemaining;
  
  // Update progress bar
  const percentage = (timeRemaining / totalTime) * 100;
  progressFill.style.width = `${percentage}%`;
  
  // Change color based on time remaining
  const timerDisplay = document.querySelector('.timer-display');
  timerDisplay.classList.remove('timer-warning', 'timer-danger');
  
  if (timeRemaining <= Math.floor(totalTime * 0.25)) {
    timerDisplay.classList.add('timer-danger');
  } else if (timeRemaining <= Math.floor(totalTime * 0.5)) {
    timerDisplay.classList.add('timer-warning');
  }
}

function createResultsTable(scores, categories, players) {
  let html = '';
  
  // For each category, create a section
  categories.forEach(category => {
    html += `
      <div class="category-results">
        <div class="category-header">
          <h3>${category}</h3>
        </div>
        <div class="player-answers">
    `;
    
    // For each player, display their answer and score for this category
    players.forEach(player => {
      const playerScore = scores[category][player.id];
      if (!playerScore) return;
      
      // Determine score class for styling
      let scoreClass = '';
      if (playerScore.score === 0) scoreClass = 'score-invalid';
      else if (playerScore.unique) scoreClass = 'score-unique';
      else scoreClass = 'score-valid';
      
      html += `
        <div class="player-answer">
          <div class="player-name">${player.name}${player.id === socket.id ? ' (You)' : ''}</div>
          <div class="answer-value">${playerScore.answer || '-'}</div>
          <div class="answer-score ${scoreClass}">${playerScore.score} points</div>
        </div>
      `;
      
      // If there are errors or suggestions, display them
      if (playerScore.errors && playerScore.errors.length > 0) {
        html += `<div class="answer-error">${playerScore.errors.join(', ')}</div>`;
      }
      
      // If there's an explanation for valid answers, display it
      if (playerScore.score > 0 && playerScore.explanation) {
        html += `<div class="answer-explanation">${playerScore.explanation}</div>`;
      }
    });
    
    // After player answers, add a suggestions section if there are any suggestions for this category
    let categorySuggestions = null;
    for (const player of players) {
      const playerScore = scores[category][player.id];
      if (playerScore && playerScore.suggestions) {
        categorySuggestions = playerScore.suggestions;
        break;
      }
    }
    
    if (categorySuggestions) {
      html += `
        <div class="category-suggestions">
          <div class="suggestion-header">Alternative options for ${category}:</div>
          <div class="suggestion-value">${categorySuggestions}</div>
        </div>
      `;
    }
    
    html += `
        </div>
      </div>
    `;
  });
  
  return html;
}

function updateScoreList() {
  // Clear score list
  scoreList.innerHTML = '';
  
  // Sort players by score (descending)
  const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);
  
  // Add each player to the list
  sortedPlayers.forEach((player, index) => {
    const listItem = document.createElement('li');
    listItem.innerHTML = `
      <span>${index + 1}. ${player.name}${player.id === socket.id ? ' (You)' : ''}</span>
      <span>${player.score} points</span>
    `;
    
    // Highlight the top player
    if (index === 0) {
      listItem.style.color = '#FF4600';
      listItem.style.fontWeight = 'bold';
    }
    
    scoreList.appendChild(listItem);
  });
}

function resetGameInputs() {
  // Clear all answer inputs
  answerInputs.forEach(input => {
    input.value = '';
    input.disabled = false;
  });
  
  // Reset submit button
  submitAnswersBtn.disabled = false;
  gameState.submitted = false;
}

function submitAnswers() {
  if (gameState.submitted) return;
  
  // Collect answers from the form
  const answers = {};
  answerInputs.forEach(input => {
    answers[input.name] = input.value.trim();
    input.disabled = true;
  });
  
  // Show loading overlay
  showLoading(true);
  
  // Submit answers
  socket.emit('submitAnswers', answers);
  
  // Update game state
  gameState.submitted = true;
  submitAnswersBtn.disabled = true;
}

// Socket.IO event listeners
socket.on('connect', () => {
  console.log('Connected to Socket.IO server with ID:', socket.id);
  
  // Force an update of the player list if we already have player data
  if (gameState.players.length > 0) {
    console.log('Forcing player list update after connection');
    updatePlayerList();
  }
  
  // Force a fix for the admin message and button
  setTimeout(() => {
    forceFixAdminControls();
  }, 1000);
});

socket.on('connect_error', (error) => {
  console.error('Socket.IO connection error:', error);
  alert('Connection error: ' + error.message + '. Please refresh the page.');
});

socket.on('playerJoined', ({ players, admin, timeLimit }) => {
  console.log('Players in room:', players);
  console.log('Admin ID:', admin);
  console.log('Socket ID:', socket.id);
  
  gameState.players = players;
  gameState.isAdmin = (admin === socket.id);
  gameState.adminId = admin;
  gameState.timeLimit = timeLimit;
  
  console.log('Is admin:', gameState.isAdmin);
  console.log('Start Game button should be:', gameState.isAdmin ? 'visible' : 'hidden');
  
  // Update lobby UI
  lobbyRoomId.textContent = gameState.roomId;
  lobbyTimeLimit.textContent = gameState.timeLimit;
  updatePlayerList();
  
  // Show lobby screen
  showScreen('lobby-screen');
  
  // Double-check button visibility after a delay
  setTimeout(() => {
    console.log('Checking Start Game button visibility after delay');
    console.log('Button display is currently:', startGameBtn.style.display);
    console.log('Admin status is:', gameState.isAdmin);
    updatePlayerList();
  }, 1000);
});

socket.on('playerLeft', ({ playerId, players }) => {
  console.log(`Player ${playerId} left. Remaining players:`, players);
  gameState.players = players;
  updatePlayerList();
});

// No longer needed since ready status functionality is removed
// socket.on('playerReady', ({ playerId, players }) => {
//   console.log(`Player ${playerId} is ready. Updated players:`, players);
//   gameState.players = players;
//   updatePlayerList();
// });

socket.on('newAdmin', ({ admin }) => {
  console.log(`New admin: ${admin}`);
  gameState.isAdmin = (admin === socket.id);
  gameState.adminId = admin;
  updatePlayerList();
});

socket.on('roundStarted', (data) => {
  // Update game state
  gameState.currentLetter = data.letter;
  gameState.submitted = false;
  
  console.log('Round started with letter:', data.letter);
  console.log('Timer end:', data.timerEnd);
  
  // Calculate time limit from timerEnd if provided
  let timeLimit = data.timeLimit || gameState.timeLimit;
  if (data.timerEnd) {
    const timerEnd = new Date(data.timerEnd);
    const now = new Date();
    timeLimit = Math.max(1, Math.floor((timerEnd - now) / 1000));
  }
  
  // Set current letter in UI
  currentLetterDisplay.textContent = data.letter;
  
  // Reset form inputs
  resetGameInputs();
  
  // Start the countdown timer
  startTimer(timeLimit);
  
  // Show game screen
  showScreen('game-screen');
});

socket.on('roundResults', ({ scores, players }) => {
  // Hide loading overlay
  showLoading(false);
  
  // Clear timer
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }
  
  // Update game state with the latest players data
  gameState.players = players;
  
  // Find admin in the players list and update admin status
  const adminPlayer = players.find(player => player.isAdmin === true);
  if (adminPlayer) {
    gameState.adminId = adminPlayer.id;
    gameState.isAdmin = (adminPlayer.id === socket.id);
    console.log("Updated admin status:", gameState.isAdmin ? "You are admin" : "You are not admin");
  }
  
  // Update UI
  const categories = ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Pflanze', 'Tier'];
  roundResultsContainer.innerHTML = createResultsTable(scores, categories, players);
  updateScoreList();
  
  // Show results screen
  showScreen('results-screen');
  
  // Show/hide next round button
  nextRoundBtn.style.display = gameState.isAdmin ? 'block' : 'none';
  console.log("Next Round button display:", gameState.isAdmin ? "block" : "none");
});

socket.on('init', (data) => {
  console.log('Received init event:', data);
  
  // If the init message includes admin info, update our state
  if (data.admin) {
    gameState.adminId = data.admin;
    gameState.isAdmin = (data.admin === socket.id);
    console.log('Init set admin status:', gameState.isAdmin ? 'You are admin' : 'You are not admin');
  }
  
  // If init includes players, update our state
  if (data.players && Array.isArray(data.players)) {
    gameState.players = data.players;
    console.log('Init received players:', gameState.players);
    
    // Update UI with the received data
    updatePlayerList();
  }
});

// Initialize UI
joinBtn.addEventListener('click', () => {
  // Get input values
  const playerName = playerNameInput.value.trim();
  const roomId = roomIdInput.value.trim();
  const timeLimit = parseInt(timeLimitInput.value);
  
  // Validate inputs
  if (!playerName) {
    alert('Please enter your name');
    return;
  }
  
  if (!roomId) {
    alert('Please enter a room ID');
    return;
  }
  
  // Store in game state
  gameState.playerName = playerName;
  gameState.roomId = roomId;
  gameState.timeLimit = timeLimit;
  
  // Join room
  socket.emit('joinRoom', { roomId, playerName, timeLimit });
  
  // Show lobby screen
  lobbyRoomId.textContent = roomId;
  lobbyTimeLimit.textContent = timeLimit;
  showScreen('lobby-screen');
});

startGameBtn.addEventListener('click', () => {
  if (gameState.isAdmin) {
    socket.emit('startRound');
  }
});

answersForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitAnswers();
});

nextRoundBtn.addEventListener('click', () => {
  console.log("Next Round button clicked, isAdmin:", gameState.isAdmin);
  if (gameState.isAdmin) {
    console.log("Emitting startRound event");
    socket.emit('startRound');
  } else {
    console.log("Not admin, can't start next round");
  }
});

closeModalBtn.addEventListener('click', hidePlayerStatusModal);

// Close modal when clicking outside the content
playerStatusModal.addEventListener('click', (e) => {
  if (e.target === playerStatusModal) {
    hidePlayerStatusModal();
  }
});

// Function to check and fix admin controls visibility
function checkAdminControlsVisibility() {
  console.log('Checking admin controls visibility');
  const adminControls = document.getElementById('admin-controls');
  const startGameBtn = document.getElementById('start-game-btn');
  
  console.log('Admin controls display:', adminControls.style.display);
  console.log('Start game button display:', startGameBtn.style.display);
  console.log('Is admin:', gameState.isAdmin);
  
  // Force visibility if needed
  adminControls.style.display = 'block';
  
  if (gameState.isAdmin) {
    // Make absolutely sure the button is visible for admins
    startGameBtn.style.display = 'inline-block';
    startGameBtn.setAttribute('style', 'display: inline-block !important');
    
    // Add a click handler to the button just to make sure it's working
    if (!startGameBtn._hasClickHandler) {
      startGameBtn.addEventListener('click', () => {
        console.log('Start Game button clicked via extra handler');
        if (gameState.isAdmin) {
          socket.emit('startRound');
        }
      });
      startGameBtn._hasClickHandler = true;
    }
    
    console.log('Start game button display after fix:', startGameBtn.style.display);
  }
}

// Add a new function to force fix admin controls
function forceFixAdminControls() {
  console.log('Forcing fix for admin controls');
  
  // Update admin message regardless of current text
  const adminMessage = document.querySelector('.admin-message');
  if (adminMessage) {
    adminMessage.textContent = 'As the admin, you can start the game anytime';
    adminMessage.style.color = '#FF4600';
    adminMessage.style.fontWeight = 'bold';
  }
  
  // Fix for admin instructions in results screen
  const adminInstructions = document.querySelector('.admin-instructions');
  if (adminInstructions) {
    adminInstructions.textContent = 'As the admin, you can start the next round anytime';
  }
  
  // Fix Start Game button for admin
  if (gameState.isAdmin) {
    const adminControls = document.getElementById('admin-controls');
    const startGameBtn = document.getElementById('start-game-btn');
    
    if (adminControls && startGameBtn) {
      // Make controls extremely visible
      adminControls.style.display = 'block';
      adminControls.style.border = '3px solid #FF4600';
      adminControls.style.padding = '20px';
      adminControls.style.backgroundColor = 'rgba(255, 70, 0, 0.1)';
      
      // Make button extremely visible
      startGameBtn.style.display = 'inline-block';
      startGameBtn.style.fontSize = '1.5rem';
      startGameBtn.style.padding = '20px 40px';
      startGameBtn.style.backgroundColor = '#FF4600';
      startGameBtn.style.color = 'white';
      startGameBtn.style.boxShadow = '0 0 20px rgba(255, 70, 0, 0.8)';
      startGameBtn.style.cursor = 'pointer';
      
      // Add big text explaining what to do
      const bigText = document.createElement('div');
      bigText.innerHTML = '<strong>CLICK THIS BUTTON TO START THE GAME!</strong>';
      bigText.style.fontSize = '1.2rem';
      bigText.style.marginBottom = '15px';
      bigText.style.color = '#FF4600';
      adminControls.insertBefore(bigText, startGameBtn);
      
      // Add direct click listener to ensure it works
      startGameBtn.onclick = () => {
        console.log('Start Game button clicked directly');
        socket.emit('startRound');
      };
    }
  }
}

// Add debug reload function
window.restartGame = function() {
  console.log('Restarting game...');
  
  // Disconnect socket
  if (socket) {
    socket.disconnect();
  }
  
  // Clear game state
  gameState = {
    playerName: '',
    roomId: '',
    isAdmin: false,
    adminId: null,
    currentLetter: null,
    submitted: false,
    timeLimit: 60,
    timer: null,
    players: [],
    timerInterval: null
  };
  
  // Show welcome screen
  showScreen('welcome-screen');
  
  // Clear any timers
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }
  
  // Reload socket connection
  socket = io({
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });
  
  // Reload page if needed
  setTimeout(() => {
    location.reload();
  }, 1000);
};

// Add a visual button for restarting the game
document.addEventListener('DOMContentLoaded', () => {
  const restartButton = document.createElement('button');
  restartButton.textContent = 'Restart Game';
  restartButton.style.position = 'fixed';
  restartButton.style.bottom = '10px';
  restartButton.style.right = '10px';
  restartButton.style.zIndex = '9999';
  restartButton.style.padding = '8px 12px';
  restartButton.style.backgroundColor = '#444';
  restartButton.style.color = 'white';
  restartButton.style.border = 'none';
  restartButton.style.borderRadius = '4px';
  restartButton.style.cursor = 'pointer';
  
  restartButton.onclick = window.restartGame;
  
  document.body.appendChild(restartButton);
}); 