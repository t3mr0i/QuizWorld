// Use the global socket from partysocket.js
const socket = window.gameSocket;

// Game configuration
const CATEGORIES = ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Pflanze', 'Tier'];

// Game state
const gameState = {
  playerName: '',
  roomId: '',
  isAdmin: false,
  adminId: '',
  currentLetter: '',
  submitted: false,
  timeLimit: 60,
  players: [],
  timerInterval: null
};

// DOM elements
const screens = {
  welcome: document.getElementById('welcome-screen'),
  lobby: document.getElementById('lobby-screen'),
  game: document.getElementById('game-screen'),
  results: document.getElementById('results-screen')
};

// Helper functions
function showScreen(screenName) {
  Object.keys(screens).forEach(key => {
    screens[key].classList.add('hidden');
    screens[key].classList.remove('active');
  });
  screens[screenName].classList.remove('hidden');
  screens[screenName].classList.add('active');
}

function updatePlayerList() {
  const playerList = document.getElementById('player-list');
  playerList.innerHTML = '';
  
  // Sort players by score (descending)
  const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);
  
  sortedPlayers.forEach(player => {
    const playerItem = document.createElement('li');
    playerItem.className = 'player-item';
    
    // Highlight if it's the current player
    if (player.id === socket.id) {
      playerItem.classList.add('current-player');
    }
    
    // Highlight if admin
    if (player.id === gameState.adminId) {
      playerItem.classList.add('admin-player');
    }
    
    playerItem.innerHTML = `
      <span class="player-name">${player.name}</span>
      <span class="player-score">${player.score || 0} points</span>
      ${player.submitted ? '<span class="status-badge submitted">✓</span>' : ''}
    `;
    
    playerList.appendChild(playerItem);
  });
  
  // Update start game button visibility
  document.getElementById('admin-controls').style.display = 'block';
  const startGameBtn = document.getElementById('start-game-btn');
  startGameBtn.style.display = 'inline-block';
  
  // Update admin message
  document.getElementById('admin-message').textContent = 'Anyone can start the game';
  
  // Update waiting message
  const waitingMessage = document.getElementById('waiting-message');
  waitingMessage.style.display = gameState.players.length <= 1 ? 'block' : 'none';
  if (gameState.players.length <= 1) {
    waitingMessage.textContent = 'Waiting for more players to join...';
  }
}

function updateScores() {
  const scoresList = document.getElementById('scores-list');
  scoresList.innerHTML = '';
  
  // Sort players by score (descending)
  const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);
  
  sortedPlayers.forEach((player, index) => {
    const scoreItem = document.createElement('li');
    scoreItem.className = 'score-item';
    
    // Highlight top player
    if (index === 0 && gameState.players.length > 1) {
      scoreItem.classList.add('top-score');
    }
    
    // Highlight current player
    if (player.id === socket.id) {
      scoreItem.classList.add('current-player');
    }
    
    scoreItem.innerHTML = `
      <span class="player-name">${player.name}</span>
      <span class="player-score">${player.score || 0} points</span>
    `;
    
    scoresList.appendChild(scoreItem);
  });
}

function startTimer(duration) {
  const timerElement = document.getElementById('timer');
  let timeLeft = duration;
  
  // Clear any existing timer
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }
  
  // Update timer immediately
  timerElement.textContent = timeLeft;
  
  // Start new timer
  gameState.timerInterval = setInterval(() => {
    timeLeft--;
    timerElement.textContent = timeLeft;
    
    // Visual countdown effect
    if (timeLeft <= 10) {
      timerElement.classList.add('time-warning');
    }
    
    if (timeLeft <= 0) {
      clearInterval(gameState.timerInterval);
      gameState.timerInterval = null;
      
      // Auto-submit if not already submitted
      if (!gameState.submitted) {
        submitAnswers();
      }
    }
  }, 1000);
}

function submitAnswers() {
  // Collect answers from form
  const form = document.getElementById('answers-form');
  const formData = new FormData(form);
  const answers = {};
  
  CATEGORIES.forEach(category => {
    answers[category] = formData.get(category) || '';
  });
  
  // Mark as submitted
  gameState.submitted = true;
  
  // Disable form
  const inputs = form.querySelectorAll('input');
  inputs.forEach(input => {
    input.disabled = true;
  });
  
  // Change submit button
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.textContent = 'Answers Submitted ✓';
  submitBtn.classList.add('btn-success');
  submitBtn.disabled = true;
  
  // Send to server
  socket.send({
    type: 'submitAnswers',
    answers
  });
}

// Socket event handlers
socket.on('connect', () => {
  console.log('Connected to game server with ID:', socket.id);
  
  // Check if reconnecting to existing game
  if (gameState.roomId) {
    // Re-join with existing data
    socket.send({
      type: 'joinRoom',
      roomId: gameState.roomId,
      playerName: gameState.playerName
    });
  }
});

socket.on('disconnect', () => {
  console.log('Disconnected from game server');
  
  // Clear timer if active
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = null;
  }
  
  // Show error modal
  showError('Lost connection to game server. Trying to reconnect...');
});

socket.on('message', (data) => {
  console.log('Received message:', data);
  
  switch (data.type) {
    case 'joined':
      // Update game state
      gameState.roomId = data.roomId;
      gameState.isAdmin = data.isAdmin;
      gameState.adminId = data.adminId;
      gameState.players = data.players;
      
      // Update UI
      document.getElementById('display-room-id').textContent = data.roomId;
      updatePlayerList();
      
      // Switch to lobby screen
      showScreen('lobby');
      break;
      
    case 'playerJoined':
      // Add player to state
      gameState.players = data.players;
      
      // Update admin ID if changed
      if (data.adminId) {
        gameState.adminId = data.adminId;
      }
      
      // Update UI
      updatePlayerList();
      break;
      
    case 'playerLeft':
      // Update player list
      gameState.players = data.players;
      
      // Update admin ID if changed
      if (data.adminId) {
        gameState.adminId = data.adminId;
      }
      
      // Update UI
      updatePlayerList();
      break;
      
    case 'roundStarted':
      // Update game state
      gameState.currentLetter = data.letter;
      gameState.submitted = false;
      
      // Update UI
      document.getElementById('current-letter').textContent = data.letter;
      
      // Create category inputs
      const categoriesContainer = document.querySelector('.categories-container');
      categoriesContainer.innerHTML = '';
      
      CATEGORIES.forEach(category => {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category';
        
        categoryDiv.innerHTML = `
          <label for="answer-${category.toLowerCase()}">${category}</label>
          <input type="text" 
                 id="answer-${category.toLowerCase()}" 
                 name="${category}" 
                 class="answer-input" 
                 placeholder="${category} with ${data.letter}..." 
                 autocomplete="off">
        `;
        
        categoriesContainer.appendChild(categoryDiv);
      });
      
      // Reset submit button
      const submitBtn = document.getElementById('submit-btn');
      submitBtn.textContent = 'Submit Answers';
      submitBtn.classList.remove('btn-success');
      submitBtn.disabled = false;
      
      // Start timer
      startTimer(data.timeLimit || gameState.timeLimit);
      
      // Switch to game screen
      showScreen('game');
      break;
      
    case 'answerReceived':
      // Update player submission status
      gameState.players.forEach(player => {
        if (player.id === data.playerId) {
          player.submitted = true;
        }
      });
      
      // Update UI
      updatePlayerList();
      break;
      
    case 'roundResults':
      // Clear timer if active
      if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
      }
      
      // Update player data
      gameState.players = data.players;
      
      // Populate results table
      const resultsBody = document.getElementById('results-body');
      resultsBody.innerHTML = '';
      
      Object.entries(data.scores).forEach(([category, categoryScores]) => {
        Object.entries(categoryScores).forEach(([playerId, scoreData]) => {
          const player = gameState.players.find(p => p.id === playerId);
          if (!player) return;
          
          const row = document.createElement('tr');
          
          // Highlight current player's rows
          if (playerId === socket.id) {
            row.classList.add('current-player');
          }
          
          row.innerHTML = `
            <td>${category}</td>
            <td>${player.name}</td>
            <td>${scoreData.answer || ''}</td>
            <td>${scoreData.score || 0}</td>
          `;
          
          resultsBody.appendChild(row);
        });
      });
      
      // Update scores list
      updateScores();
      
      // Switch to results screen
      showScreen('results');
      break;
      
    case 'error':
      showError(data.message);
      break;
  }
});

// Button event handlers
document.getElementById('join-game-btn').addEventListener('click', () => {
  const playerName = document.getElementById('player-name').value.trim();
  const roomId = document.getElementById('room-id').value.trim();
  const timeLimit = parseInt(document.getElementById('time-limit').value, 10) || 60;
  
  if (!playerName) {
    showError('Please enter your name');
    return;
  }
  
  // Store in game state
  gameState.playerName = playerName;
  gameState.timeLimit = timeLimit;
  
  // Connect to room
  socket.connectToRoom(roomId, playerName, timeLimit);
});

document.getElementById('start-game-btn').addEventListener('click', () => {
  socket.send({
    type: 'startRound',
    timeLimit: gameState.timeLimit
  });
});

document.getElementById('answers-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitAnswers();
});

document.getElementById('next-round-btn').addEventListener('click', () => {
  console.log('Starting next round');
  socket.send({
    type: 'startRound',
    timeLimit: gameState.timeLimit
  });
});

document.getElementById('copy-link-btn').addEventListener('click', () => {
  const roomId = gameState.roomId;
  const url = `${window.location.origin}?room=${roomId}`;
  
  navigator.clipboard.writeText(url)
    .then(() => {
      const btn = document.getElementById('copy-link-btn');
      const originalText = btn.textContent;
      
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    })
    .catch(err => {
      showError('Failed to copy link: ' + err.message);
    });
});

document.getElementById('debug-btn').addEventListener('click', () => {
  const roomIdInput = document.getElementById('room-id');
  const randomRoomId = Math.floor(Math.random() * 1000000).toString();
  roomIdInput.value = randomRoomId;
  
  alert('Random room ID generated. Enter your name and click "Join Game" to start a new game.');
});

document.getElementById('error-close-btn').addEventListener('click', () => {
  document.getElementById('error-modal').classList.add('hidden');
});

// Helper functions
function showError(message) {
  const errorModal = document.getElementById('error-modal');
  const errorMessage = document.getElementById('error-message');
  
  errorMessage.textContent = message;
  errorModal.classList.remove('hidden');
}

// Check URL for room ID parameter
function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room');
  
  if (roomId) {
    document.getElementById('room-id').value = roomId;
  }
}

// Initialize
function init() {
  checkUrlParams();
}

// Start everything when DOM is loaded
document.addEventListener('DOMContentLoaded', init); 