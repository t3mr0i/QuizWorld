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
  timerInterval: null,
  // Add debugging fields
  lastSubmitTime: null,
  validationTimeoutId: null,
  categories: ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Tier', 'Pflanze'] // Default categories
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
  console.log(`Attempting to show screen: ${screenId}`);
  
  // If passed a simple name, convert to full ID
  const fullScreenId = screenId.includes('-') ? screenId : `${screenId}-screen`;
  
  // Hide all screens first
  document.querySelectorAll('.game-screen').forEach(screen => {
    screen.classList.remove('active');
    screen.classList.add('hidden');
    console.log(`Hidden screen: ${screen.id}`);
  });
  
  // Then show the requested screen with a fade-in animation
  const targetScreen = document.getElementById(fullScreenId);
  if (targetScreen) {
    console.log(`Showing screen: ${fullScreenId}`);
    targetScreen.classList.remove('hidden');
    // Small delay to allow the DOM to update before adding the active class
    setTimeout(() => {
      targetScreen.classList.add('active');
    }, 50);
  } else {
    console.error(`Screen not found: ${fullScreenId}`);
    // List all available screens for debugging
    const availableScreens = [];
    document.querySelectorAll('.game-screen').forEach(screen => {
      availableScreens.push(screen.id);
    });
    console.log(`Available screens: ${availableScreens.join(', ')}`);
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
  
  gameState.categories.forEach(category => {
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
  
  console.log('===== ANSWER SUBMISSION DEBUG =====');
  console.log('Submitting answers:', answers);
  console.log('Current letter:', gameState.currentLetter);
  console.log('Time limit:', gameState.timeLimit);
  console.log('Room ID:', gameState.roomId);
  console.log('Player name:', gameState.playerName);
  console.log('===================================');
  
  // Check if any answers are empty
  const emptyAnswers = Object.entries(answers).filter(([_, value]) => !value);
  if (emptyAnswers.length > 0) {
    console.warn('Some answers are empty:', emptyAnswers.map(([key]) => key));
  }
  
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
  gameState.lastSubmitTime = Date.now();
  
  // Set a timeout to check if validation is taking too long
  if (gameState.validationTimeoutId) {
    clearTimeout(gameState.validationTimeoutId);
  }
  
  gameState.validationTimeoutId = setTimeout(() => {
    console.warn('⚠️ Answer validation is taking longer than expected (5s)');
    console.log('Time since submission:', (Date.now() - gameState.lastSubmitTime) / 1000, 'seconds');
    
    // Check again at 10 seconds
    gameState.validationTimeoutId = setTimeout(() => {
      console.warn('⚠️ Answer validation appears to be stalled (10s without response)');
      console.log('Time since submission:', (Date.now() - gameState.lastSubmitTime) / 1000, 'seconds');
      console.log('This could indicate the server is not processing the validation or there is no API key configured');
    }, 5000);
  }, 5000);
  
  // Send answers to server
  const messageData = {
    type: 'submitAnswers',
    answers: answers,
    letter: gameState.currentLetter, // Add letter for context
    playerName: gameState.playerName // Add player name for logging
  };

  console.log('Sending message to server:', messageData);
  const sendResult = socket.send(messageData);
  console.log('Message send result:', sendResult);
}

// Add a temporary validation function to handle when server validation fails
function validateAnswersLocally(answers, letter) {
  if (!answers || !letter) return false;
  
  console.log('🧠 Performing local validation as fallback because server validation failed');
  console.log('Letter:', letter, 'Answers:', answers);
  
  // Check if answers start with the correct letter (case-insensitive)
  const results = {};
  let allValid = true;
  
  Object.keys(answers).forEach(category => {
    const answer = answers[category];
    
    // Skip validation for empty answers
    if (!answer || answer.trim() === '') {
      results[category] = { valid: false, points: 0, explanation: "Empty answer" };
      return;
    }
    
    // Basic check: does it start with the right letter?
    const startsWithLetter = answer.trim().toLowerCase().startsWith(letter.toLowerCase());
    
    results[category] = {
      answer: answer,
      valid: startsWithLetter,
      points: startsWithLetter ? 10 : 0, // Assign 10 points for valid answers (can't check uniqueness locally)
      explanation: startsWithLetter 
        ? `Accepted: Starts with letter ${letter}` 
        : `Invalid: Does not start with letter ${letter}`
    };
    
    if (!startsWithLetter) {
      allValid = false;
    }
  });
  
  console.log('Local validation results:', results);
  return {
    valid: allValid,
    results: results
  };
}

// Socket event handlers
socket.on('message', (data) => {
  console.log('Received message:', data);
  
  // Clear validation timeout when we get any response
  if (gameState.validationTimeoutId) {
    clearTimeout(gameState.validationTimeoutId);
    gameState.validationTimeoutId = null;
  }
  
  if (data.type === 'playerSubmitted' || data.type === 'roundResults') {
    console.log('✅ Received validation response after:', 
      (Date.now() - (gameState.lastSubmitTime || Date.now())) / 1000, 'seconds');
  }
  
  switch (data.type) {
    case 'joinedRoom':
      // Update game state
      gameState.roomId = data.roomId;
      gameState.players = data.players;
      
      // Make sure the admin ID is correctly set
      gameState.adminId = data.adminId;
      
      // Update categories if provided
      if (data.categories) {
        gameState.categories = data.categories;
        renderCategoryList();
      }
      
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
      } else {
        console.error('Admin controls element not found');
      }
      
      // Log screen transition
      console.log('Transitioning to lobby screen, current screens:', {
        welcome: document.getElementById('welcome-screen')?.className,
        lobby: document.getElementById('lobby-screen')?.className
      });
      
      // Switch to lobby screen
      showScreen('lobby');
      
      // Check if screen transition worked and force refresh if needed
      setTimeout(() => {
        const lobbyScreen = document.getElementById('lobby-screen');
        const welcomeScreen = document.getElementById('welcome-screen');
        
        console.log('After transition, screen states:', {
          welcome: welcomeScreen?.className,
          lobby: lobbyScreen?.className
        });
        
        // If lobby screen still has 'hidden' class after transition, force refresh
        if (lobbyScreen && lobbyScreen.classList.contains('hidden')) {
          console.warn('Lobby screen still hidden after transition - forcing refresh');
          forceRefreshScreen('lobby');
        }
        
        // Double check admin controls visibility
        const adminControls = document.getElementById('admin-controls');
        if (adminControls && gameState.isAdmin && adminControls.style.display !== 'block') {
          console.warn('Admin controls not visible - fixing display');
          adminControls.style.display = 'block';
          
          // Also ensure start button is visible
          const startGameBtn = document.getElementById('start-game-btn');
          if (startGameBtn) {
            startGameBtn.style.display = 'block';
          }
        }
      }, 200);
      
      break;
      
    case 'joined':
      // Update game state
      gameState.roomId = data.roomId;
      
      // Set admin status based on the message
      gameState.adminId = data.adminId;
      gameState.isAdmin = data.isAdmin; // For 'joined' we update our own admin status
      
      // Update categories if provided
      if (data.categories) {
        gameState.categories = data.categories;
        renderCategoryList();
      }
      
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
      
      // Reset UI elements
      const answerInputs = document.querySelectorAll('.category-group input');
      answerInputs.forEach(input => {
        input.disabled = false;
        input.classList.remove('submitted');
        input.value = '';
      });
      
      const submitButton = document.getElementById('submit-btn');
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Submit Answers';
        submitButton.classList.remove('btn-submitted');
      }
      
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
      console.error('Server error:', data);
      
      if (data.message === 'Error validating answers') {
        console.error('VALIDATION ERROR DETAILS:');
        console.error('- Current game state:', { 
          letter: gameState.currentLetter,
          roomId: gameState.roomId,
          playerName: gameState.playerName,
          timeLimit: gameState.timeLimit,
          submitted: gameState.submitted
        });
        
        // Log the answers that were submitted
        const submittedAnswers = {};
        document.querySelectorAll('.category-group input').forEach(input => {
          submittedAnswers[input.name] = input.value;
          console.error(`  ${input.name}: "${input.value}"`);
        });
        
        console.error('- Players in game:', gameState.players);
        console.error('- Error timestamp:', new Date().toISOString());
        
        // Try the fallback validation
        if (gameState.submitted && gameState.currentLetter) {
          const localValidation = validateAnswersLocally(submittedAnswers, gameState.currentLetter);
          
          console.log('Local validation results:', localValidation);
          
          // Show error with more helpful information about the server issue
          showError(`Answer validation failed (API key issue on server). ${gameState.isAdmin ? "As the host, you can continue by starting the next round." : "Please wait for the host to start the next round."}`);
          
          // Show admin continue button if admin
          if (gameState.isAdmin) {
            const adminActions = document.createElement('div');
            adminActions.className = 'admin-actions';
            adminActions.innerHTML = `
              <button class="btn btn-accent" id="admin-continue-btn">
                Start Next Round
              </button>
            `;
            
            // Find where to insert the admin actions
            const errorMessage = document.getElementById('error-message');
            if (errorMessage) {
              errorMessage.appendChild(adminActions);
              
              // Add event listener
              document.getElementById('admin-continue-btn').addEventListener('click', () => {
                // Close error modal
                document.getElementById('error-modal').classList.add('hidden');
                
                // Send start round message
                socket.send({
                  type: 'startRound'
                });
              });
            }
          }
        } else {
          showError('Answer validation failed. Please wait for the host to start the next round.');
        }
      } else {
        showError(data.message);
      }
      break;
      
    case 'categoriesUpdated':
      // Update game state with new categories
      gameState.categories = data.categories;
      
      // Update UI if in lobby
      renderCategoryList();
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

  // Setup dynamic button text for join/create game
  setupDynamicJoinButton();

  // Join Game button
  const joinGameBtn = document.getElementById('join-game-btn');
  if (joinGameBtn) {
    joinGameBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('player-name');
      const roomInput = document.getElementById('room-id');
      const timeInput = document.getElementById('time-limit');
      
      if (!nameInput.value.trim()) {
        nameInput.classList.add('error');
        nameInput.focus();
        return;
      }
      
      // Update UI to show connecting state
      const originalText = joinGameBtn.textContent;
      joinGameBtn.disabled = true;
      joinGameBtn.textContent = 'Connecting...';
      
      try {
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
      } catch (error) {
        console.error('Connection failed:', error);
        showError(error.message || 'Failed to connect to game server. Please try again later.');
        
        // Reset button state
        joinGameBtn.disabled = false;
        joinGameBtn.textContent = originalText;
      }
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
      // Update button text after setting room ID from URL
      updateJoinButtonText();
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

// Function to setup the dynamic join/create button functionality
function setupDynamicJoinButton() {
  const roomIdInput = document.getElementById('room-id');
  const joinGameBtn = document.getElementById('join-game-btn');
  
  if (roomIdInput && joinGameBtn) {
    // Set initial button text based on room ID input
    updateJoinButtonText();
    
    // Update button text when room ID input changes
    roomIdInput.addEventListener('input', updateJoinButtonText);
  }
}

// Function to update the join/create button text and help text based on room ID input
function updateJoinButtonText() {
  const roomIdInput = document.getElementById('room-id');
  const joinGameBtn = document.getElementById('join-game-btn');
  
  if (!roomIdInput || !joinGameBtn) return;
  
  const roomIdHelp = roomIdInput.nextElementSibling; // The small help text element
  const hasRoomId = roomIdInput.value.trim() !== '';
  
  // Update button text
  joinGameBtn.textContent = hasRoomId ? 'Join Game' : 'Create Game';
  
  // Update helper text
  if (roomIdHelp) {
    roomIdHelp.textContent = hasRoomId 
      ? 'Join an existing game room' 
      : 'Leave empty to create a new game room';
  }
}

// Show error function
function showError(message) {
  console.error('Error message:', message);
  
  const errorModal = document.getElementById('error-modal');
  const errorMessage = document.getElementById('error-message');
  
  if (!errorModal || !errorMessage) {
    console.error('Error modal elements not found');
    alert(message); // Fallback to alert if modal not found
    return;
  }
  
  // Check if this is an answer validation error and provide more helpful information
  if (message.includes('Answer validation failed')) {
    // Create a more detailed error message with troubleshooting steps
    const detailedMessage = document.createElement('div');
    
    const mainError = document.createElement('p');
    mainError.textContent = message;
    detailedMessage.appendChild(mainError);
    
    const troubleshootingHeader = document.createElement('p');
    troubleshootingHeader.innerHTML = '<strong>Possible solutions:</strong>';
    detailedMessage.appendChild(troubleshootingHeader);
    
    const troubleshootingList = document.createElement('ul');
    
    const serverItem = document.createElement('li');
    serverItem.textContent = 'The server may be missing API keys for OpenAI or other services';
    troubleshootingList.appendChild(serverItem);
    
    const rateLimitItem = document.createElement('li');
    rateLimitItem.textContent = 'The server may be experiencing rate limiting from the API service';
    troubleshootingList.appendChild(rateLimitItem);
    
    const continueItem = document.createElement('li');
    if (gameState.isAdmin) {
      continueItem.innerHTML = '<strong>As the host, you can continue by starting the next round</strong>';
    } else {
      continueItem.textContent = 'Ask the host to start the next round to continue playing';
    }
    troubleshootingList.appendChild(continueItem);
    
    detailedMessage.appendChild(troubleshootingList);
    
    // Append detailed message instead of just text
    errorMessage.innerHTML = '';
    errorMessage.appendChild(detailedMessage);
  } else {
    // Regular error message
    errorMessage.textContent = message;
  }
  
  errorModal.classList.remove('hidden');
  
  // Reset join game button if it was disabled
  const joinGameBtn = document.getElementById('join-game-btn');
  if (joinGameBtn && joinGameBtn.disabled) {
    joinGameBtn.disabled = false;
    joinGameBtn.textContent = gameState.roomId ? 'Join Game' : 'Create Game';
    console.log('Reset join game button state');
  }
}

// Add animation to the round results display
function displayRoundResults(data) {
  if (gameState.timerInterval) {
    clearInterval(gameState.timerInterval);
  }
  
  // Clear previous results
  const resultsTable = document.getElementById('results-table');
  resultsTable.innerHTML = '';
  
  // Create table header
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  
  // Add player name column
  const playerNameHeader = document.createElement('th');
  playerNameHeader.textContent = 'Spieler';
  headerRow.appendChild(playerNameHeader);
  
  // Add category columns
  const allCategories = new Set();
  Object.values(data.scores).forEach(playerScores => {
    Object.keys(playerScores).forEach(category => {
      allCategories.add(category);
    });
  });
  
  Array.from(allCategories).sort().forEach(category => {
    const th = document.createElement('th');
    th.textContent = category;
    headerRow.appendChild(th);
  });
  
  // Add total score column
  const totalHeader = document.createElement('th');
  totalHeader.textContent = 'Gesamt';
  headerRow.appendChild(totalHeader);
  
  thead.appendChild(headerRow);
  table.appendChild(thead);
  
  // Create table body
  const tbody = document.createElement('tbody');
  
  // Sort players by total score (descending)
  const sortedPlayers = Object.entries(data.scores)
    .map(([playerId, scores]) => {
      const total = Object.values(scores).reduce((sum, score) => sum + (score.score || 0), 0);
      return { playerId, total };
    })
    .sort((a, b) => b.total - a.total)
    .map(entry => entry.playerId);
  
  // Add rows for each player
  sortedPlayers.forEach(playerId => {
    const row = document.createElement('tr');
    
    // Add player name cell
    const playerNameCell = document.createElement('td');
    const player = data.players.find(p => p.id === playerId);
    playerNameCell.textContent = player ? player.name : playerId;
    row.appendChild(playerNameCell);
    
    // Add category cells
    Array.from(allCategories).sort().forEach(category => {
      const td = document.createElement('td');
      const scoreData = data.scores[category][playerId];
      
      if (scoreData) {
        const { answer, score, explanation, suggestion } = scoreData;
        
        // Create answer container
        const answerContainer = document.createElement('div');
        answerContainer.className = 'answer-container';
        
        // Add answer text
        const answerText = document.createElement('div');
        answerText.className = 'answer-text';
        answerText.textContent = answer || '-';
        answerContainer.appendChild(answerText);
        
        // Add points if score exists
        if (score !== undefined) {
          const pointsDiv = document.createElement('div');
          pointsDiv.className = 'points';
          pointsDiv.textContent = `${score} Punkte`;
          answerContainer.appendChild(pointsDiv);
        }
        
        // Add explanation if available
        if (explanation) {
          const explanationDiv = document.createElement('div');
          explanationDiv.className = 'answer-explanation';
          explanationDiv.textContent = explanation;
          answerContainer.appendChild(explanationDiv);
        }
        
        // Add suggestion if available
        if (suggestion) {
          const suggestionDiv = document.createElement('div');
          suggestionDiv.className = 'answer-suggestion';
          suggestionDiv.textContent = `Vorschlag: ${suggestion}`;
          answerContainer.appendChild(suggestionDiv);
        }
        
        td.appendChild(answerContainer);
        
        // Add appropriate class based on score
        td.classList.add(score > 0 ? 'valid-answer' : 'invalid-answer');
      } else {
        td.textContent = '-';
        td.classList.add('no-answer');
      }
      
      row.appendChild(td);
    });
    
    // Add total score cell
    const totalCell = document.createElement('td');
    totalCell.className = 'total-score';
    const total = Object.values(data.scores).reduce((sum, categoryScores) => {
      const playerScore = categoryScores[playerId];
      return sum + (playerScore ? playerScore.score || 0 : 0);
    }, 0);
    totalCell.textContent = total;
    row.appendChild(totalCell);
    
    tbody.appendChild(row);
  });
  
  table.appendChild(tbody);
  resultsTable.appendChild(table);
  
  // Update the leaderboard with the new scores
  updateScores(data.players);
  
  // Show results screen
  showScreen('results');
}

// Add this function to handle screen refresh
function forceRefreshScreen(screenId) {
  console.log(`Force refreshing screen: ${screenId}`);
  
  // Get the screen element
  const fullScreenId = screenId.includes('-') ? screenId : `${screenId}-screen`;
  const screen = document.getElementById(fullScreenId);
  
  if (!screen) {
    console.error(`Cannot refresh screen - not found: ${fullScreenId}`);
    return;
  }
  
  // Force a reflow by toggling display
  const currentDisplay = window.getComputedStyle(screen).display;
  screen.style.display = 'none';
  
  // Read offsetHeight to force a reflow
  void screen.offsetHeight;
  
  // Reset display and ensure classes are correct
  screen.style.display = '';
  screen.classList.remove('hidden');
  screen.classList.add('active');
  
  // Make sure other screens are hidden
  document.querySelectorAll('.game-screen').forEach(otherScreen => {
    if (otherScreen.id !== fullScreenId) {
      otherScreen.classList.remove('active');
      otherScreen.classList.add('hidden');
    }
  });
  
  console.log(`Screen refresh complete: ${fullScreenId}`);
}

// Add category management functions
function addCategoryInput() {
  const categoryList = document.getElementById('categoryList');
  const newCategoryDiv = document.createElement('div');
  newCategoryDiv.className = 'category-input';
  newCategoryDiv.innerHTML = `
    <input type="text" class="category-name" placeholder="Neue Kategorie">
    <button class="remove-category" onclick="removeCategory(this)">×</button>
  `;
  categoryList.appendChild(newCategoryDiv);
  
  // Add event listener to update categories when input changes
  const input = newCategoryDiv.querySelector('input');
  input.addEventListener('input', updateCategories);
}

function removeCategory(button) {
  const categoryDiv = button.parentElement;
  categoryDiv.remove();
  updateCategories();
}

function getCategories() {
  const categoryInputs = document.querySelectorAll('.category-name');
  return Array.from(categoryInputs).map(input => input.value.trim()).filter(Boolean);
}

// Add function to update categories with debounce
let categoryUpdateTimeout = null;
function updateCategories() {
  // Clear any existing timeout
  if (categoryUpdateTimeout) {
    clearTimeout(categoryUpdateTimeout);
  }
  
  // Set a timeout to avoid sending too many messages while typing
  categoryUpdateTimeout = setTimeout(() => {
    const categories = getCategories();
    if (categories.length === 0) return;
    
    console.log('Updating categories:', categories);
    
    // Send update to server
    socket.send({
      type: 'updateCategories',
      categories: categories
    });
  }, 300); // 300ms delay
}

// Update the join room function to include custom categories
async function joinRoom(roomId) {
  try {
    const categories = getCategories();
    const response = await fetch(`/api/join-room/${roomId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        playerName: gameState.playerName,
        categories: categories.length > 0 ? categories : undefined
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to join room');
    }

    const data = await response.json();
    gameState.roomId = roomId;
    gameState.players = data.players;
    gameState.adminId = data.adminId;
    gameState.isAdmin = data.isAdmin;
    gameState.categories = data.categories || gameState.categories; // Store categories from server

    // Update UI to show game interface
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').style.display = 'block';
    
    // Initialize game state
    initializeGame();
  } catch (error) {
    console.error('Error joining room:', error);
    alert('Failed to join room. Please try again.');
  }
}

// Update the lobby HTML
function showLobby() {
  const lobbyHtml = `
    <div class="lobby-container">
      <h2>Stadt, Land, Fluss</h2>
      <div class="player-setup">
        <input type="text" id="playerName" placeholder="Dein Name" maxlength="20">
        <button onclick="createRoom()">Neues Spiel erstellen</button>
      </div>
      <div class="join-room">
        <input type="text" id="roomId" placeholder="Raum-ID">
        <button onclick="joinRoom(document.getElementById('roomId').value)">Raum beitreten</button>
      </div>
      <div class="category-management">
        <h3>Kategorien</h3>
        <div id="categoryList">
          ${gameState.categories ? gameState.categories.map(category => `
            <div class="category-input">
              <input type="text" class="category-name" value="${category}" onchange="updateCategories()">
              <button class="remove-category" onclick="removeCategory(this)">×</button>
            </div>
          `).join('') : `
            <div class="category-input">
              <input type="text" class="category-name" value="Stadt">
              <button class="remove-category" onclick="removeCategory(this)">×</button>
            </div>
            <div class="category-input">
              <input type="text" class="category-name" value="Land">
              <button class="remove-category" onclick="removeCategory(this)">×</button>
            </div>
            <div class="category-input">
              <input type="text" class="category-name" value="Fluss">
              <button class="remove-category" onclick="removeCategory(this)">×</button>
            </div>
            <div class="category-input">
              <input type="text" class="category-name" value="Name">
              <button class="remove-category" onclick="removeCategory(this)">×</button>
            </div>
            <div class="category-input">
              <input type="text" class="category-name" value="Beruf">
              <button class="remove-category" onclick="removeCategory(this)">×</button>
            </div>
            <div class="category-input">
              <input type="text" class="category-name" value="Pflanze">
              <button class="remove-category" onclick="removeCategory(this)">×</button>
            </div>
            <div class="category-input">
              <input type="text" class="category-name" value="Tier">
              <button class="remove-category" onclick="removeCategory(this)">×</button>
            </div>
          `}
        </div>
        <button onclick="addCategoryInput()" class="add-category">+ Kategorie hinzufügen</button>
      </div>
    </div>
  `;
  document.getElementById('lobby').innerHTML = lobbyHtml;
}

// Initialize game state
function initializeGame() {
  // Implement any necessary initialization logic
}

// Add this function to render the category list
function renderCategoryList() {
  const categoryList = document.getElementById('categoryList');
  if (!categoryList) return;
  
  categoryList.innerHTML = '';
  
  gameState.categories.forEach(category => {
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category-input';
    categoryDiv.innerHTML = `
      <input type="text" class="category-name" value="${category}" onchange="updateCategories()">
      <button class="remove-category" onclick="removeCategory(this)">×</button>
    `;
    categoryList.appendChild(categoryDiv);
  });
} 