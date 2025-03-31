// Use the global socket from partysocket.js
const socket = window.gameSocket;

// Game configuration
const CATEGORIES = ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Tier', 'Pflanze'];

// Game state
const gameState = {
  playerName: '',
  roomId: '',
  isAdmin: false,
  adminId: null,
  currentLetter: '',
  submitted: false,
  timeLimit: 60,
  players: [],
  timerInterval: null
};

// DOM elements - get references to all screens
const screens = {
  welcome: document.getElementById('welcome-screen'),
  lobby: document.getElementById('lobby-screen'),
  game: document.getElementById('game-screen'),
  results: document.getElementById('results-screen')
};

// Helper functions
function showScreen(screenId) {
  document.querySelectorAll('.game-screen').forEach(screen => {
    screen.classList.add('hidden');
    screen.classList.remove('active');
  });
  const targetScreen = document.getElementById(`${screenId}-screen`);
  if (targetScreen) {
    targetScreen.classList.remove('hidden');
    targetScreen.classList.add('active');
  }
}

function updatePlayerList(players, adminId) {
  const playerList = document.getElementById('player-list');
  if (!playerList) return;
  
  // Sort players by admin status, then name
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.id === adminId && b.id !== adminId) return -1;
    if (a.id !== adminId && b.id === adminId) return 1;
    return a.name.localeCompare(b.name);
  });
  
  playerList.innerHTML = '';
  
  sortedPlayers.forEach(player => {
    const li = document.createElement('li');
    
    // Add classes for styling
    li.classList.add('player-item');
    if (player.id === socket.id) {
      li.classList.add('current-player');
    }
    if (player.id === adminId) {
      li.classList.add('admin-player');
    }
    
    // Create player name element with appropriate badges
    const playerNameSpan = document.createElement('span');
    playerNameSpan.classList.add('player-name');
    playerNameSpan.textContent = player.name;
    li.appendChild(playerNameSpan);
    
    // Add badges
    if (player.id === socket.id) {
      const youBadge = document.createElement('span');
      youBadge.classList.add('badge', 'badge-you');
      youBadge.textContent = 'You';
      li.appendChild(youBadge);
    }
    
    if (player.id === adminId) {
      const adminBadge = document.createElement('span');
      adminBadge.classList.add('badge', 'badge-admin');
      adminBadge.textContent = 'Host';
      li.appendChild(adminBadge);
    }
    
    // Add status indicator for submitted answers during game
    if (gameState.currentLetter && player.submitted) {
      const statusBadge = document.createElement('span');
      statusBadge.classList.add('badge', 'badge-submitted');
      statusBadge.textContent = 'Ready';
      li.appendChild(statusBadge);
    }
    
    playerList.appendChild(li);
  });
  
  // Update waiting message visibility
  const waitingMessage = document.getElementById('waiting-message');
  if (waitingMessage) {
    waitingMessage.style.display = players.length <= 1 ? 'block' : 'none';
  }
}

function updateScores() {
  const scoresList = document.getElementById('scores-list');
  if (!scoresList) return;
  
  // Get players and sort by score
  const sortedPlayers = [...gameState.players].sort((a, b) => {
    return (b.score || 0) - (a.score || 0);
  });
  
  scoresList.innerHTML = '';
  
  sortedPlayers.forEach((player, index) => {
    const li = document.createElement('li');
    li.classList.add('score-item');
    
    // Highlight current player
    if (player.id === socket.id) {
      li.classList.add('current-player');
    }
    
    // Add ranking
    const rankBadge = document.createElement('span');
    rankBadge.classList.add('rank');
    rankBadge.textContent = `#${index + 1}`;
    li.appendChild(rankBadge);
    
    // Add player name
    const playerName = document.createElement('span');
    playerName.classList.add('player-name');
    playerName.textContent = `${player.name}${player.id === socket.id ? ' (You)' : ''}`;
    li.appendChild(playerName);
    
    // Add score
    const scoreSpan = document.createElement('span');
    scoreSpan.classList.add('score');
    scoreSpan.textContent = `${player.score || 0} pts`;
    li.appendChild(scoreSpan);
    
    scoresList.appendChild(li);
  });
}

function setupCategoriesForm(letter) {
  const categoriesContainer = document.querySelector('.categories-container');
  if (!categoriesContainer) return;
  
  categoriesContainer.innerHTML = '';
  
  CATEGORIES.forEach(category => {
    const categoryGroup = document.createElement('div');
    categoryGroup.classList.add('category-group');
    
    const label = document.createElement('label');
    label.setAttribute('for', `answer-${category.toLowerCase()}`);
    label.textContent = category;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `answer-${category.toLowerCase()}`;
    input.name = category;
    input.autocomplete = 'off';
    input.placeholder = `${category} with ${letter}...`;
    
    categoryGroup.appendChild(label);
    categoryGroup.appendChild(input);
    categoriesContainer.appendChild(categoryGroup);
  });
  
  // Focus the first input field
  const firstInput = categoriesContainer.querySelector('input');
  if (firstInput) {
    firstInput.focus();
  }
}

function startTimer(duration) {
  // Clear existing timer if any
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }
  
  const timerElement = document.getElementById('timer');
  if (!timerElement) return;
  
  let timeRemaining = duration;
  timerElement.textContent = timeRemaining;
  
  gameState.timerInterval = setInterval(() => {
    timeRemaining--;
    timerElement.textContent = timeRemaining;
    
    // Add visual indication for time running out
    if (timeRemaining <= 10) {
      timerElement.classList.add('timer-warning');
    }
    
    if (timeRemaining <= 5) {
      timerElement.classList.add('timer-danger');
    }
    
    if (timeRemaining <= 0) {
      clearInterval(gameState.timerInterval);
      gameState.timerInterval = null;
      
      // Auto-submit answers if not already submitted
      if (!gameState.submitted) {
        submitAnswers();
      }
    }
  }, 1000);
}

function submitAnswers() {
  if (gameState.submitted) return;
  
  const answerInputs = document.querySelectorAll('.category-group input');
  const answers = {};
  
  answerInputs.forEach(input => {
    answers[input.name] = input.value.trim();
  });
  
  // Add visual indication that answers are submitted
  answerInputs.forEach(input => {
    input.disabled = true;
    input.classList.add('submitted');
  });
  
  const submitButton = document.getElementById('submit-btn');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Answers Submitted';
    submitButton.classList.add('btn-submitted');
  }
  
  // Update game state
  gameState.submitted = true;
  
  // Send answers to server
  socket.send(JSON.stringify({
    type: 'submitAnswers',
    answers: answers
  }));
}

// Socket event handlers
socket.on('message', (data) => {
  console.log('Received message:', data);
  
  switch (data.type) {
    case 'joinedRoom':
      // Update game state
      gameState.roomId = data.roomId;
      gameState.isAdmin = data.isAdmin;
      gameState.adminId = data.adminId;
      gameState.players = data.players;
      
      // Update UI
      const roomIdDisplay = document.getElementById('display-room-id');
      if (roomIdDisplay) {
        roomIdDisplay.textContent = data.roomId;
      }
      
      updatePlayerList(data.players, data.adminId);
      
      // Show/hide admin controls
      const adminControls = document.getElementById('admin-controls');
      if (adminControls) {
        adminControls.style.display = data.isAdmin ? 'block' : 'none';
      }
      
      // Switch to lobby screen
      showScreen('lobby');
      break;
      
    case 'playerJoined':
      // Update game state
      gameState.players = data.players;
      gameState.adminId = data.adminId;
      
      // Update UI
      updatePlayerList(data.players, data.adminId);
      break;
      
    case 'playerLeft':
      // Update game state
      gameState.players = data.players;
      gameState.adminId = data.adminId;
      
      // Check if admin status changed
      if (data.newAdmin && data.newAdmin === socket.id) {
        gameState.isAdmin = true;
        
        // Show admin controls
        const adminControls = document.getElementById('admin-controls');
        if (adminControls) {
          adminControls.style.display = 'block';
        }
      }
      
      // Update UI
      updatePlayerList(data.players, data.adminId);
      break;
      
    case 'roundStarted':
      // Reset game state for new round
      gameState.currentLetter = data.letter;
      gameState.submitted = false;
      
      // Update UI
      const letterDisplay = document.getElementById('current-letter');
      if (letterDisplay) {
        letterDisplay.textContent = data.letter;
      }
      
      setupCategoriesForm(data.letter);
      
      // Start timer
      startTimer(data.timeLimit);
      
      // Switch to game screen
      showScreen('game');
      break;
      
    case 'playerSubmitted':
      // Update player list to show who has submitted
      gameState.players = data.players;
      updatePlayerList(data.players, gameState.adminId);
      break;
      
    case 'roundResults':
      // Clear timer if active
      if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
      }
      
      // Update player data
      gameState.players = data.players;
      
      // Create improved results table with categories in columns
      const resultsBody = document.getElementById('results-body');
      if (resultsBody) {
        resultsBody.innerHTML = '';
        
        // Get all players
        const players = gameState.players;
        
        // For each category, create a section in the results table
        CATEGORIES.forEach(category => {
          // Add a category header row
          const categoryRow = document.createElement('tr');
          categoryRow.className = 'category-header';
          categoryRow.innerHTML = `
            <td colspan="4" class="category-name">${category}</td>
          `;
          resultsBody.appendChild(categoryRow);
          
          // For each player, show their answer and score for this category
          Object.values(players).forEach(player => {
            if (!data.scores[category] || !data.scores[category][player.id]) return;
            
            const scoreData = data.scores[category][player.id];
            
            const row = document.createElement('tr');
            
            // Highlight current player's rows
            if (player.id === socket.id) {
              row.classList.add('current-player');
            }
            
            // Determine score class based on points
            let scoreClass = '';
            const points = scoreData.score || 0;
            
            if (points === 20) {
              scoreClass = 'score-unique';
            } else if (points === 10) {
              scoreClass = 'score-valid';
            } else {
              scoreClass = 'score-invalid';
            }
            
            row.innerHTML = `
              <td>${player.name}${player.id === socket.id ? ' (You)' : ''}</td>
              <td>${scoreData.answer || '-'}</td>
              <td class="${scoreClass}">${points} points</td>
              <td>${scoreData.explanation || ''}</td>
            `;
            
            resultsBody.appendChild(row);
          });
          
          // Add a spacer row after each category
          const spacerRow = document.createElement('tr');
          spacerRow.className = 'category-spacer';
          spacerRow.innerHTML = '<td colspan="4"></td>';
          resultsBody.appendChild(spacerRow);
        });
      }
      
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

socket.on('connect', () => {
  console.log('Connected to game server with ID:', socket.id);
  
  // Check if reconnecting to existing game
  if (gameState.roomId) {
    // Re-join with existing data
    socket.send(JSON.stringify({
      type: 'joinRoom',
      roomId: gameState.roomId,
      playerName: gameState.playerName
    }));
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

socket.on('error', (error) => {
  console.error('Socket error:', error);
  showError('Connection error: ' + (error.message || 'Unknown error'));
});

// Attach event listeners once DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Time selector buttons
  const decreaseBtn = document.querySelector('.time-btn.decrease');
  const increaseBtn = document.querySelector('.time-btn.increase');
  const timeInput = document.getElementById('time-limit');
  
  if (decreaseBtn && increaseBtn && timeInput) {
    decreaseBtn.addEventListener('click', () => {
      let value = parseInt(timeInput.value, 10) || 60;
      value = Math.max(30, value - 10);
      timeInput.value = value;
    });
    
    increaseBtn.addEventListener('click', () => {
      let value = parseInt(timeInput.value, 10) || 60;
      value = Math.min(300, value + 10);
      timeInput.value = value;
    });
  }

  // Join Game button
  const joinGameBtn = document.getElementById('join-game-btn');
  if (joinGameBtn) {
    joinGameBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('player-name');
      const roomInput = document.getElementById('room-id');
      const timeInput = document.getElementById('time-limit');
      
      if (!nameInput.value.trim()) {
        nameInput.classList.add('error');
        nameInput.focus();
        return;
      }
      
      // Update game state
      gameState.playerName = nameInput.value.trim();
      gameState.roomId = roomInput.value.trim();
      gameState.timeLimit = parseInt(timeInput.value, 10) || 60;
      
      // Connect to socket and join room
      socket.connectToRoom(
        gameState.roomId,
        gameState.playerName,
        gameState.timeLimit
      );
    });
  }
  
  // Start Game button
  const startGameBtn = document.getElementById('start-game-btn');
  if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
      socket.send(JSON.stringify({
        type: 'startRound'
      }));
    });
  }
  
  // Submit Answers button and form
  const answersForm = document.getElementById('answers-form');
  if (answersForm) {
    answersForm.addEventListener('submit', event => {
      event.preventDefault();
      submitAnswers();
    });
  }
  
  // Next Round button
  const nextRoundBtn = document.getElementById('next-round-btn');
  if (nextRoundBtn) {
    nextRoundBtn.addEventListener('click', () => {
      socket.send(JSON.stringify({
        type: 'startRound'
      }));
    });
  }
  
  // Copy Invite Link button
  const copyLinkBtn = document.getElementById('copy-link-btn');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      const roomId = document.getElementById('display-room-id').textContent;
      const url = `${window.location.origin}?room=${roomId}`;
      
      navigator.clipboard.writeText(url).then(
        () => {
          // Change button text temporarily
          const originalText = copyLinkBtn.innerHTML;
          copyLinkBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
          copyLinkBtn.classList.add('success');
          
          setTimeout(() => {
            copyLinkBtn.innerHTML = originalText;
            copyLinkBtn.classList.remove('success');
          }, 2000);
        },
        err => {
          console.error('Could not copy text: ', err);
        }
      );
    });
  }
  
  // Error modal close button
  const errorCloseBtn = document.getElementById('error-close-btn');
  const errorOkBtn = document.getElementById('error-ok-btn');
  if (errorCloseBtn && errorOkBtn) {
    const closeErrorModal = () => {
      document.getElementById('error-modal').classList.add('hidden');
    };
    
    errorCloseBtn.addEventListener('click', closeErrorModal);
    errorOkBtn.addEventListener('click', closeErrorModal);
  }
  
  // Check URL for room ID parameter
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    const roomInput = document.getElementById('room-id');
    if (roomInput) {
      roomInput.value = roomParam;
    }
  }
  
  // Debug button
  const debugBtn = document.getElementById('debug-btn');
  if (debugBtn) {
    debugBtn.addEventListener('click', () => {
      const debugInfo = {
        browser: navigator.userAgent,
        location: window.location.href,
        connectionState: socket.getState()
      };
      
      console.log('Debug info:', debugInfo);
      alert('Debug info has been logged to the console. Please open the browser console to view it.');
    });
  }
});

// Helper functions
function showError(message) {
  console.error(message);
  
  const errorModal = document.getElementById('error-modal');
  const errorMessage = document.getElementById('error-message');
  
  if (!errorModal || !errorMessage) {
    console.error('Error modal elements not found');
    alert(message); // Fallback to alert if modal not found
    return;
  }
  
  errorMessage.textContent = message;
  errorModal.classList.remove('hidden');
} 