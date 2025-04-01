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
  // Hide all screens first
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.classList.add('hidden');
  });
  
  // Then show the requested screen with a fade-in animation
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.classList.remove('hidden');
    // Small delay to allow the DOM to update before adding the active class
    setTimeout(() => {
      targetScreen.classList.add('active');
    }, 50);
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

function updateScores(players) {
  const scoresList = document.getElementById('scores-list');
  if (!scoresList) return;
  
  // Clear previous scores
  scoresList.innerHTML = '';
  
  // Get players array either from parameter or gameState
  const playerArray = players || gameState.players;
  
  // Sort players by score in descending order
  const sortedPlayers = [...playerArray].sort((a, b) => (b.score || 0) - (a.score || 0));
  
  // Create and append list items for each player
  sortedPlayers.forEach((player, index) => {
    const li = document.createElement('li');
    li.className = 'player-item';
    
    // Add 'current-player' class if this is the current user
    if (player.id === socket.id) {
      li.classList.add('current-player');
    }
    
    // Create rank badge with appropriate class
    const rankDiv = document.createElement('div');
    rankDiv.className = `rank-badge${index === 0 ? ' rank-1' : ''}`;
    rankDiv.id = `rank-${index + 1}`;
    rankDiv.textContent = index + 1;
    
    // Create player name div
    const nameDiv = document.createElement('div');
    nameDiv.className = 'player-name';
    nameDiv.textContent = player.name;
    
    // Add indication if this is the current player
    if (player.id === socket.id) {
      const youSpan = document.createElement('span');
      youSpan.className = 'you-label';
      youSpan.textContent = ' (You)';
      nameDiv.appendChild(youSpan);
    }
    
    // Create score div
    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'player-score';
    scoreDiv.textContent = `${player.score || 0} pts`;
    
    // Add all elements to the list item
    li.appendChild(rankDiv);
    li.appendChild(nameDiv);
    li.appendChild(scoreDiv);
    
    // Add the list item to the scores list
    scoresList.appendChild(li);
  });
}

function setupCategoriesForm(letter) {
  const categoriesGrid = document.querySelector('.categories-grid');
  if (!categoriesGrid) return;
  
  categoriesGrid.innerHTML = '';
  
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
    categoriesGrid.appendChild(categoryGroup);
  });
  
  // Focus the first input field
  const firstInput = categoriesGrid.querySelector('input');
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
  
  // Reset timer classes
  timerElement.classList.remove('timer-warning', 'timer-danger');
  
  gameState.timerInterval = setInterval(() => {
    timeRemaining--;
    timerElement.textContent = timeRemaining;
    
    // Add visual indication for time running out
    // Only turn red and enlarge in the last 10 seconds
    if (timeRemaining <= 10) {
      timerElement.classList.remove('timer-warning');
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
  socket.send({
    type: 'submitAnswers',
    answers: answers
  });
}

// Socket event handlers
socket.on('message', (data) => {
  console.log('Received message:', data);
  
  switch (data.type) {
    case 'joinedRoom':
      // Update game state
      gameState.roomId = data.roomId;
      gameState.players = data.players;
      
      // Make sure the admin ID is correctly set
      gameState.adminId = data.adminId;
      
      // Important: Only update isAdmin status if this is about the current player
      // For messages about other players joining, preserve current admin status
      if (data.playerId === socket.id) {
        gameState.isAdmin = data.isAdmin;
      }
      
      // Log admin status for debugging
      console.log('Admin status:', {
        playerId: data.playerId, 
        socketId: socket.id, 
        adminId: data.adminId, 
        isAdmin: gameState.isAdmin
      });
      
      // Update UI
      const roomIdDisplay = document.getElementById('display-room-id');
      if (roomIdDisplay) {
        roomIdDisplay.textContent = data.roomId;
      }
      
      updatePlayerList(data.players, data.adminId);
      
      // Show/hide admin controls based on current player's admin status
      const adminControls = document.getElementById('admin-controls');
      if (adminControls) {
        console.log('Setting admin controls display to:', gameState.isAdmin ? 'block' : 'none');
        adminControls.style.display = gameState.isAdmin ? 'block' : 'none';
        
        // Explicitly make sure the start game button is visible when admin controls are shown
        const startGameBtn = document.getElementById('start-game-btn');
        if (startGameBtn && gameState.isAdmin) {
          console.log('Ensuring start game button is visible');
          startGameBtn.style.display = 'block';
        }
      }
      
      // Switch to lobby screen
      showScreen('lobby');
      break;
      
    case 'joined':
      // Update game state
      gameState.roomId = data.roomId;
      
      // Set admin status based on the message
      gameState.adminId = data.adminId;
      gameState.isAdmin = data.isAdmin; // For 'joined' we update our own admin status
      
      // Log for debugging
      console.log('Joined with admin status:', {
        socketId: socket.id, 
        adminId: data.adminId, 
        isAdmin: gameState.isAdmin
      });
      
      gameState.players = data.players;
      
      // Update UI
      const roomDisplay = document.getElementById('display-room-id');
      if (roomDisplay) {
        roomDisplay.textContent = data.roomId;
      }
      
      updatePlayerList(data.players, data.adminId);
      
      // Show/hide admin controls based on our admin status
      const adminPanel = document.getElementById('admin-controls');
      if (adminPanel) {
        console.log('Setting admin controls display to:', gameState.isAdmin ? 'block' : 'none');
        adminPanel.style.display = gameState.isAdmin ? 'block' : 'none';
        
        // Explicitly make sure the start game button is visible when admin controls are shown
        const startGameBtn = document.getElementById('start-game-btn');
        if (startGameBtn && gameState.isAdmin) {
          console.log('Ensuring start game button is visible');
          startGameBtn.style.display = 'block';
        }
      }
      
      // Switch to lobby screen
      showScreen('lobby');
      break;
      
    case 'playerJoined':
      // Update game state
      gameState.players = data.players;
      gameState.adminId = data.adminId;
      
      // Log admin status for playerJoined event
      console.log('playerJoined - Admin status:', {
        socketId: socket.id, 
        adminId: data.adminId,
        isAdmin: gameState.isAdmin
      });
      
      // Update UI
      updatePlayerList(data.players, data.adminId);
      
      // Re-check admin controls visibility to ensure they stay visible
      if (gameState.isAdmin) {
        const adminControls = document.getElementById('admin-controls');
        if (adminControls) {
          console.log('Re-ensuring admin controls are visible after player join');
          adminControls.style.display = 'block';
          
          // Make sure start game button is visible
          const startGameBtn = document.getElementById('start-game-btn');
          if (startGameBtn) {
            startGameBtn.style.display = 'block';
          }
        }
      }
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
      
      // Debug: log the scores data structure 
      console.log('Round Results data:', data);
      
      // Update the letter display in results screen
      const resultLetterEl = document.getElementById('result-letter');
      if (resultLetterEl && gameState.currentLetter) {
        resultLetterEl.textContent = gameState.currentLetter;
      }
      
      // Add animation to the round results display
      displayRoundResults(data);
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
      socket.send({
        type: 'startRound'
      });
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
      socket.send({
        type: 'startRound'
      });
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

// Add animation to the round results display
function displayRoundResults(data) {
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = null;
  }
  
  // Update player data with the new scores
  gameState.players = data.players;
  
  console.log("Scores data structure:", data.scores);
  
  // Clear the results area first
  const resultsTable = document.getElementById('results-table');
  resultsTable.innerHTML = '';
  
  if (!data.scores || Object.keys(data.scores).length === 0) {
    const noResultsMsg = document.createElement('div');
    noResultsMsg.className = 'no-results-message';
    noResultsMsg.textContent = 'No results available for this round.';
    resultsTable.appendChild(noResultsMsg);
  } else {
    // Create an improved results table with categories in columns
    const table = document.createElement('table');
    table.className = 'results-grid animated-table';
    
    // Create header row with categories
    const headerRow = document.createElement('tr');
    
    // Add player name column header
    const playerHeader = document.createElement('th');
    playerHeader.textContent = 'Player';
    headerRow.appendChild(playerHeader);
    
    // Get all unique categories
    const allCategories = new Set();
    Object.values(data.scores).forEach(playerScores => {
      Object.keys(playerScores).forEach(category => {
        if (category !== 'total') {
          allCategories.add(category);
        }
      });
    });
    
    // Add category headers
    Array.from(allCategories).sort().forEach(category => {
      const th = document.createElement('th');
      th.textContent = category;
      headerRow.appendChild(th);
    });
    
    // Add total score header
    const totalHeader = document.createElement('th');
    totalHeader.textContent = 'Total';
    headerRow.appendChild(totalHeader);
    
    table.appendChild(headerRow);
    
    // Create a row for each player
    Object.keys(data.scores).forEach((playerId, index) => {
      const playerScores = data.scores[playerId];
      const playerName = data.players.find(p => p.id === playerId)?.name || 'Unknown Player';
      
      const row = document.createElement('tr');
      
      // Add animation delay for staggered appearance
      row.style.animationDelay = `${index * 0.1}s`;
      
      // If this is the current player, highlight the row
      if (playerId === socket.id) {
        row.classList.add('current-player-row');
      }
      
      // Add player name cell
      const nameCell = document.createElement('td');
      nameCell.className = 'player-name-cell';
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = playerName;
      
      if (playerId === socket.id) {
        nameSpan.innerHTML += ' <span class="you-label">(You)</span>';
      }
      
      nameCell.appendChild(nameSpan);
      row.appendChild(nameCell);
      
      // Add cells for each category
      Array.from(allCategories).sort().forEach(category => {
        const td = document.createElement('td');
        
        if (playerScores[category]) {
          const pointsObj = playerScores[category];
          const answerText = pointsObj.answer || '-';
          const points = pointsObj.points || 0;
          const explanation = pointsObj.explanation || '';
          
          // Create wrapper for answer and points
          const answerDiv = document.createElement('div');
          answerDiv.className = 'answer-container';
          
          // Add the answer text
          const answerSpan = document.createElement('span');
          answerSpan.className = `answer-text score-${points > 0 ? 'valid' : 'invalid'}`;
          answerSpan.textContent = answerText;
          answerDiv.appendChild(answerSpan);
          
          // Add the points badge
          const pointsBadge = document.createElement('span');
          pointsBadge.className = `points-badge ${points > 0 ? 'valid-points' : 'invalid-points'}`;
          pointsBadge.textContent = points;
          answerDiv.appendChild(pointsBadge);
          
          td.appendChild(answerDiv);
          
          // Format and add explanation if available
          if (explanation) {
            const explanationDiv = document.createElement('div');
            explanationDiv.className = 'answer-explanation';
            
            // Format the explanation based on validity
            if (points > 0) {
              explanationDiv.innerHTML = `<strong>✓ Valid:</strong> ${explanation}`;
            } else {
              const parts = explanation.split(/\s*\.\s*/);
              let formattedExplanation = `<strong>✗ Invalid:</strong> ${parts[0]}.`;
              
              // Add suggestions in a highlighted way if they exist
              if (explanation.toLowerCase().includes('suggest')) {
                const suggestionMatch = explanation.match(/suggest\w*\s+['"]?([^'"]+)['"]?/i);
                if (suggestionMatch && suggestionMatch[1]) {
                  formattedExplanation += ` <span class="suggestion">Suggestion: ${suggestionMatch[1]}</span>`;
                }
              } else if (parts.length > 1) {
                formattedExplanation += ` ${parts.slice(1).join('. ')}`;
              }
              
              explanationDiv.innerHTML = formattedExplanation;
            }
            
            td.appendChild(explanationDiv);
          }
          
          // Add appropriate class based on points
          td.classList.add(points > 0 ? 'valid-answer' : 'invalid-answer');
        } else {
          td.textContent = '-';
          td.classList.add('no-answer');
        }
        
        row.appendChild(td);
      });
      
      // Add total score cell
      const totalCell = document.createElement('td');
      totalCell.className = 'total-score';
      totalCell.textContent = playerScores.total || '0';
      row.appendChild(totalCell);
      
      table.appendChild(row);
    });
    
    resultsTable.appendChild(table);
  }
  
  // Update the leaderboard with the new scores
  updateScores(data.players);
  
  // Show results screen
  showScreen('results');
} 