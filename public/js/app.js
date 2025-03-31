// Connect to Socket.IO server
const socket = io();

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
          ${player.isReady ? 
            '<span class="status-badge ready">Ready</span>' : 
            '<span class="status-badge not-ready">Not Ready</span>'}
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
    
    if (player.isReady) {
      statusIndicator.classList.add('status-ready');
    } else {
      statusIndicator.classList.add('status-online');
    }
    
    // Create player name text with player ID for debugging
    const playerName = document.createElement('span');
    playerName.textContent = player.name + (player.id === socket.id ? ' (You)' : '');
    
    // Create status text
    const statusText = document.createElement('span');
    statusText.textContent = player.isReady ? 'Ready' : 'Not Ready';
    
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
    listItem.appendChild(statusText);
    
    // Make the list item clickable to show detailed status
    listItem.style.cursor = 'pointer';
    listItem.addEventListener('click', showPlayerStatusModal);
    
    playerList.appendChild(listItem);
  });
  
  // Show/hide admin controls
  startGameBtn.style.display = gameState.isAdmin ? 'block' : 'none';
  
  // Update player count in game screen
  totalPlayersDisplay.textContent = gameState.players.length;
  readyPlayersDisplay.textContent = gameState.players.filter(p => p.isReady).length;
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

// Event Listeners
joinBtn.addEventListener('click', () => {
  const playerName = playerNameInput.value.trim();
  const roomId = roomIdInput.value.trim() || Math.random().toString(36).substring(2, 8);
  const timeLimit = parseInt(timeLimitInput.value, 10) || 60;
  
  // Validate inputs
  if (!playerName) {
    alert('Please enter your name');
    return;
  }
  
  if (timeLimit < 10 || timeLimit > 300) {
    alert('Time limit must be between 10 and 300 seconds');
    return;
  }
  
  // Update game state
  gameState.playerName = playerName;
  gameState.roomId = roomId;
  gameState.timeLimit = timeLimit;
  
  // Join the room
  socket.emit('joinRoom', { playerName, roomId, timeLimit });
  
  // Update UI
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

// Socket event handlers
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('playerJoined', ({ players, admin, timeLimit }) => {
  console.log('Players in room:', players);
  console.log('Admin ID:', admin);
  
  gameState.players = players;
  gameState.isAdmin = (admin === socket.id);
  gameState.adminId = admin;
  gameState.timeLimit = timeLimit;
  
  // Update lobby UI
  lobbyRoomId.textContent = gameState.roomId;
  lobbyTimeLimit.textContent = gameState.timeLimit;
  updatePlayerList();
  
  // Show lobby screen
  showScreen('lobby-screen');
});

socket.on('playerLeft', ({ playerId, players }) => {
  console.log(`Player ${playerId} left. Remaining players:`, players);
  gameState.players = players;
  updatePlayerList();
});

socket.on('playerReady', ({ playerId, players }) => {
  console.log(`Player ${playerId} is ready. Updated players:`, players);
  gameState.players = players;
  updatePlayerList();
});

socket.on('newAdmin', ({ admin }) => {
  console.log(`New admin: ${admin}`);
  gameState.isAdmin = (admin === socket.id);
  gameState.adminId = admin;
  updatePlayerList();
});

socket.on('roundStarted', ({ letter, timeLimit, players }) => {
  // Update game state
  gameState.currentLetter = letter;
  gameState.submitted = false;
  
  // If players data is provided, update it
  if (players) {
    console.log('Updated players list for new round:', players);
    gameState.players = players;
    updatePlayerList();
  }
  
  // Set current letter in UI
  currentLetterDisplay.textContent = letter;
  
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