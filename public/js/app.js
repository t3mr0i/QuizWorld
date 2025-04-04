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
  categories: ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Tier', 'Pflanze'], // Default categories
  isReady: false, // Track if current player is ready
  readyCount: 0,   // Count of ready players
  clientSideMode: false // Track if we're using client-side mode
};

// DOM elements - get references to all screens
const screens = {
  welcome: document.getElementById('welcome-screen'),
  lobby: document.getElementById('lobby-screen'),
  game: document.getElementById('game-screen'),
  results: document.getElementById('results-screen')
};

// Add DOM-related utility functions to optimize common operations
const DOM = {
  get: id => document.getElementById(id),
  query: (selector, parent = document) => parent.querySelector(selector),
  queryAll: (selector, parent = document) => parent.querySelectorAll(selector),
  
  // Create element with attributes and children
  create: (tag, attributes = {}, children = []) => {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'innerHTML') {
        element.innerHTML = value;
      } else {
        element.setAttribute(key, value);
      }
    });
    
    // Append children
    children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        element.appendChild(child);
      }
    });
    
    return element;
  }
};

// Helper functions
function showScreen(screenId) {
  console.log(`Showing screen: ${screenId}`);
  
  // Hide all screens first
  DOM.queryAll('.game-screen').forEach(screen => {
    screen.classList.remove('active');
    screen.classList.add('hidden');
  });
  
  // Show the requested screen
  const fullScreenId = screenId.includes('-') ? screenId : `${screenId}-screen`;
  const screen = DOM.get(fullScreenId);
  
  if (screen) {
    console.log(`Showing screen: ${fullScreenId}`);
    screen.classList.remove('hidden');
    
    // Special handling for welcome screen - make sure button text is correct
    if (screenId === 'welcome') {
      console.log('Welcome screen shown, updating join button text...');
      setTimeout(updateJoinButtonText, 100); // Short delay to ensure DOM is ready
    }
    
    // Special handling for lobby screen - make sure categories are visible
    if (screenId === 'lobby') {
      console.log('Lobby screen shown, initializing category management...');
      setTimeout(() => {
        initializeCategoryManagement(); 
        
        // Attach ready button event listener
        const readyBtn = document.getElementById('ready-btn');
        if (readyBtn) {
          // Remove existing listener to avoid duplicates
          const newReadyBtn = readyBtn.cloneNode(true);
          readyBtn.parentNode.replaceChild(newReadyBtn, readyBtn);
          
          // Add fresh listener
          newReadyBtn.addEventListener('click', toggleReady);
          console.log('Ready button listener attached in lobby');
          
          // Make sure button is not disabled
          newReadyBtn.disabled = false;
        }
        
        // Update ready status display
        updateReadyStatus();
      }, 100); // Short delay to ensure DOM is ready
    }
    
    // Small delay to allow the DOM to update before adding the active class
    setTimeout(() => {
      screen.classList.add('active');
    }, 50);
  } else {
    console.error(`Screen not found: ${fullScreenId}`);
    // List all available screens for debugging
    const availableScreens = [];
    DOM.queryAll('.game-screen').forEach(screen => {
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
  
  // Update waiting message visibility - but don't hide admin controls
  const waitingMessage = document.getElementById('waiting-message');
  if (waitingMessage) {
    // Change message but always allow game to start
    if (players.length <= 1) {
      waitingMessage.textContent = '';
      waitingMessage.innerHTML = '<p>You can start playing alone - just click the START GAME button at the bottom!</p>';
      waitingMessage.style.display = 'block';
    } else {
      // Still show start button for non-admin players too
      waitingMessage.textContent = '';
      waitingMessage.innerHTML = '<p>Everyone is ready? Click the START GAME button at the bottom!</p>';
      waitingMessage.style.display = 'block';
    }
  }
  
  // Always ensure admin controls are visible for the admin
  if (gameState.isAdmin) {
    const adminControls = document.getElementById('admin-controls');
    const gameStarter = document.getElementById('game-starter');
    const prominentStartBtn = document.getElementById('prominent-start-btn');
    
    if (adminControls) {
      console.log('Ensuring admin controls are visible');
      adminControls.style.display = 'flex';
    }
    
    if (gameStarter) {
      gameStarter.style.display = 'flex';
      
      // Make sure start game button is visible
      const startGameBtn = document.getElementById('start-game-btn');
      if (startGameBtn) {
        startGameBtn.style.display = 'flex';
        startGameBtn.style.visibility = 'visible';
        startGameBtn.disabled = false;
      }
    }
    
    // Make sure prominent start button is visible if it exists
    if (prominentStartBtn) {
      prominentStartBtn.style.display = 'block';
      const container = prominentStartBtn.closest('.prominent-start-container');
      if (container) {
        container.style.display = 'flex';
      }
    } else {
      // If it doesn't exist yet, try to create it
      const lobbyBody = document.querySelector('#lobby-screen .card-body');
      if (lobbyBody && !document.querySelector('.prominent-start-container')) {
        console.log('Adding missing prominent start button to lobby');
        
        // Create container for the button
        const startButtonContainer = document.createElement('div');
        startButtonContainer.className = 'prominent-start-container';
        
        // Create the button
        const newPromStartBtn = document.createElement('button');
        newPromStartBtn.id = 'prominent-start-btn';
        newPromStartBtn.className = 'btn btn-accent btn-large prominent-start-btn';
        newPromStartBtn.innerHTML = '<span class="start-icon">▶</span> START GAME';
        
        // Add click handler
        newPromStartBtn.addEventListener('click', startNewRound);
        
        // Add instructional text
        const instructionText = document.createElement('p');
        instructionText.className = 'start-instruction';
        instructionText.textContent = 'Click to start the game when everyone is ready!';
        
        // Add to container
        startButtonContainer.appendChild(newPromStartBtn);
        startButtonContainer.appendChild(instructionText);
        
        // Add to the lobby
        lobbyBody.appendChild(startButtonContainer);
      }
    }
  } else {
    // For non-admin players, hide admin controls and start button
    const adminControls = document.getElementById('admin-controls');
    const gameStarter = document.getElementById('game-starter');
    const prominentStartContainer = document.querySelector('.prominent-start-container');
    
    if (adminControls) {
      adminControls.style.display = 'none';
    }
    
    if (gameStarter) {
      gameStarter.style.display = 'none';
    }
    
    if (prominentStartContainer) {
      prominentStartContainer.style.display = 'none';
    }
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
  // Update the current letter display
  document.getElementById('current-letter').textContent = letter;
  
  // Set the current letter in game state
  gameState.currentLetter = letter;
  
  // Get the categories container
  const categoriesGrid = document.querySelector('.categories-grid');
  if (!categoriesGrid) return;
  
  // Clear existing categories
  categoriesGrid.innerHTML = '';
  
  // Add form fields for each category
  gameState.categories.forEach(category => {
    const categoryGroup = document.createElement('div');
    categoryGroup.className = 'category-group';
    
    const label = document.createElement('label');
    label.textContent = category;
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'answer-input';
    input.setAttribute('data-category', category);
    input.placeholder = `${category} with ${letter}...`;
    input.autocomplete = 'off';
    
    categoryGroup.appendChild(label);
    categoryGroup.appendChild(input);
    categoriesGrid.appendChild(categoryGroup);
  });
  
  // Add client-side mode indicator if needed
  if (gameState.clientSideMode || window.CONFIG?.ALLOW_ANYONE_TO_START) {
    const indicator = document.createElement('div');
    indicator.className = 'client-mode-indicator';
    indicator.textContent = 'Client-Side Mode Active';
    indicator.style.fontSize = '12px';
    indicator.style.padding = '5px';
    indicator.style.margin = '10px 0';
    indicator.style.backgroundColor = '#f8d7da';
    indicator.style.color = '#721c24';
    indicator.style.borderRadius = '4px';
    indicator.style.textAlign = 'center';
    
    const gameHeader = document.querySelector('.game-header');
    if (gameHeader) {
      gameHeader.appendChild(indicator);
    }
  }
  
  // Reset submission state
  gameState.submitted = false;
  
  // Focus the first input
  const firstInput = document.querySelector('.answer-input');
  if (firstInput) firstInput.focus();
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
  // If answers already submitted, don't do it again
  if (gameState.submitted) {
    console.log('Answers already submitted!');
    return;
  }
  
  // Get all input fields
  const inputs = document.querySelectorAll('.answer-input');
  const answers = {};
  
  // Collect answers
  inputs.forEach(input => {
    const category = input.getAttribute('data-category');
    const value = input.value.trim();
    if (value) {
      answers[category] = value;
    }
  });
  
  // Debug logging
  console.log('===== ANSWER SUBMISSION DEBUG =====');
  console.log('Submitting answers:', answers);
  console.log('Current letter:', gameState.currentLetter);
  console.log('Time limit:', gameState.timeLimit);
  console.log('Room ID:', gameState.roomId);
  console.log('Player name:', gameState.playerName);
  console.log('Client-side mode:', gameState.clientSideMode);
  console.log('===================================');
  
  // Mark answers as submitted
  gameState.submitted = true;
  
  // Disable form
  document.getElementById('submit-btn').disabled = true;
  inputs.forEach(input => input.disabled = true);
  
  // Show loading state
  document.getElementById('submit-btn').textContent = 'Waiting for others...';
  
  try {
    // In client-side mode, process answers locally if server returns an error
    const message = {
      type: 'submitAnswers',
      answers: answers,
      letter: gameState.currentLetter,
      playerName: gameState.playerName
    };
    
    // Send message to server
    console.log('Sending message to server:', message);
    const sendResult = socket.send(JSON.stringify(message));
    console.log('Message send result:', sendResult);
    
    // For single player or client-side mode, set a timeout to show results
    // if we don't hear back from the server
    if (gameState.clientSideMode) {
      console.log('🔧 CLIENT-SIDE MODE: Setting up local validation fallback...');
      
      gameState.validationTimeoutId = setTimeout(() => {
        console.log('🔧 CLIENT-SIDE MODE: Server did not respond, processing results locally');
        
        // Check if we already got a response from server
        if (document.getElementById('results-screen').classList.contains('active')) {
          console.log('Results already showing, canceling local validation');
          return;
        }
        
        // Process answers locally
        const results = validateAnswersLocally(answers, gameState.currentLetter);
        
        // Structure results in the format expected by displayRoundResults
        const structuredResults = {
          scores: {},
          players: [{ id: 'local', name: gameState.playerName, score: 0 }],
          categories: gameState.categories
        };
        
        // Format results
        gameState.categories.forEach(category => {
          structuredResults.scores[category] = {};
          
          const answer = answers[category] || '';
          let score = 0;
          let explanation = 'No answer provided';
          
          if (answer && results[category]) {
            score = results[category].valid ? 10 : 0;
            explanation = results[category].explanation;
          }
          
          structuredResults.scores[category]['local'] = {
            answer,
            score,
            explanation
          };
          
          // Add to player's total score
          structuredResults.players[0].score += score;
        });
        
        // Show results
        displayRoundResults(structuredResults);
      }, 3000); // Wait 3 seconds for server before falling back to local
    }
  } catch (error) {
    console.error('Error submitting answers:', error);
    showError('Error submitting answers. Please try again.');
    
    // Re-enable form
    document.getElementById('submit-btn').disabled = false;
    document.getElementById('submit-btn').textContent = 'Submit Answers';
    inputs.forEach(input => input.disabled = false);
    gameState.submitted = false;
  }
}

// Add a temporary validation function to handle when server validation fails
function validateAnswersLocally(answers, letter) {
  console.log('🔧 CLIENT-SIDE MODE: Validating answers locally:', answers, 'for letter:', letter);
  
  if (!letter || typeof letter !== 'string') {
    console.error('Invalid letter for validation:', letter);
    return {};
  }
  
  // Convert letter to uppercase
  letter = letter.toUpperCase();
  const results = {};
  
  // Process each category and answer
  Object.entries(answers).forEach(([category, answer]) => {
    // Skip empty answers
    if (!answer || typeof answer !== 'string') {
      results[category] = {
        valid: false,
        explanation: 'No answer provided'
      };
      return;
    }
    
    // Trim and normalize the answer
    const processedAnswer = answer.trim();
    
    // Check if the answer starts with the correct letter (case insensitive)
    const startsWithLetter = processedAnswer.toUpperCase().startsWith(letter);
    
    if (startsWithLetter) {
      results[category] = {
        valid: true,
        explanation: `Valid answer for ${category} starting with '${letter}'`
      };
    } else {
      results[category] = {
        valid: false,
        explanation: `Answer does not start with the letter '${letter}'`
      };
    }
  });
  
  console.log('🔧 CLIENT-SIDE MODE: Local validation results:', results);
  return results;
}

// Socket event handlers
function setupSocketEvents() {
  socket.on('message', (data) => {
    console.log('Received message:', data);
    
    // Clear validation timeout when we get any response
    if (gameState.validationTimeoutId) {
      clearTimeout(gameState.validationTimeoutId);
      gameState.validationTimeoutId = null;
    }
    
    // If this is an error message, handle it specially
    if (data.type === 'error') {
      console.log('Server error:', data);
      console.log('Error message:', data.message);
      
      // Handle "No round in progress" error specially when in client-side mode
      if (gameState.clientSideMode && data.message === "No round in progress") {
        console.log('🔧 CLIENT-SIDE MODE: Ignoring "No round in progress" error');
        
        // If we're on the game screen and have submitted answers, 
        // trigger the local validation immediately instead of waiting
        if (gameState.submitted && document.getElementById('game-screen').classList.contains('active')) {
          console.log('🔧 CLIENT-SIDE MODE: Triggering immediate local validation');
          
          // Clear any existing timeout
          if (gameState.validationTimeoutId) {
            clearTimeout(gameState.validationTimeoutId);
          }
          
          // Get the answers from the form
          const inputs = document.querySelectorAll('.answer-input');
          const answers = {};
          
          inputs.forEach(input => {
            const category = input.getAttribute('data-category');
            const value = input.value.trim();
            if (value) {
              answers[category] = value;
            }
          });
          
          // Process answers locally
          const results = validateAnswersLocally(answers, gameState.currentLetter);
          
          // Structure results for display
          const structuredResults = {
            scores: {},
            players: [{ id: 'local', name: gameState.playerName, score: 0 }],
            categories: gameState.categories
          };
          
          // Format results
          gameState.categories.forEach(category => {
            structuredResults.scores[category] = {};
            
            const answer = answers[category] || '';
            let score = 0;
            let explanation = 'No answer provided';
            
            if (answer && results[category]) {
              score = results[category].valid ? 10 : 0;
              explanation = results[category].explanation;
            }
            
            structuredResults.scores[category]['local'] = {
              answer,
              score,
              explanation
            };
            
            // Add to player's total score
            structuredResults.players[0].score += score;
          });
          
          // Show results
          displayRoundResults(structuredResults);
        }
        
        // Don't show error to the user - this is expected in client-side mode
        return;
      }
      
      // Special handling for "Only the admin can start the game" error
      if (data.message && data.message.includes("Only the admin")) {
        console.log('⚠️ Host detection issue: "Only admin can start game" error received');
        
        // Count ready players and check if we can start using client-side workaround
        const readyPlayers = gameState.readyCount || 0;
        const totalPlayers = gameState.players.length || 1;
        const requiredReady = totalPlayers <= 2 ? totalPlayers : Math.ceil(totalPlayers / 2);
        
        if (readyPlayers >= requiredReady || totalPlayers <= 1) {
          console.log('🔧 WORKAROUND: Enough players are ready, trying client-side start...');
          
          // Enable client-side mode if not already enabled
          if (!window.CONFIG) window.CONFIG = {};
          window.CONFIG.ALLOW_ANYONE_TO_START = true;
          
          // Try to start the game again
          startNewRound();
          return;
        }
      }
      
      // Show error to user for other errors
      showError(data.message);
      return;
    }
    
    // Process other message types with the existing switch statement
    switch (data.type) {
      case 'joinedRoom':
        // ... existing code ...
        break;
      
      case 'joined':
        // ... existing code ...
        break;
      
      // ... and so on for all other cases ...
    }
  });
  
  // Other socket event handlers
  // ... existing code ...
}

// Initialize the game
function init() {
  console.log('Initializing app...');
  
  // Check for URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  
  // Set client-side mode if URL parameter is present
  if (urlParams.has('all-start') || urlParams.has('allow-all')) {
    console.log('🔧 CLIENT-SIDE MODE: Enabled via URL parameter');
    if (!window.CONFIG) window.CONFIG = {};
    window.CONFIG.ALLOW_ANYONE_TO_START = true;
    gameState.clientSideMode = true;
  }
  
  // Setup event listeners
  setupDynamicJoinButton();
  setupCategoryListeners();
  
  // Initialize game
  showScreen('welcome');
  
  // Setup socket connection events
  setupSocketEvents();
  
  // Set up start game button
  document.getElementById('start-game-btn').addEventListener('click', startNewRound);
  
  // Set up next round button
  document.getElementById('next-round-btn').addEventListener('click', startNewRound);
  
  // Set up universal start button
  document.getElementById('universal-start-btn').addEventListener('click', startNewRound);
  
  // Set up ready button
  document.getElementById('ready-btn').addEventListener('click', toggleReady);
  
  console.log('App initialized');
}

// Update player list in lobby
function updatePlayerList() {
  const playerList = document.getElementById('player-list');
  playerList.innerHTML = '';
  
  gameState.players.forEach(player => {
    const playerItem = document.createElement('li');
    playerItem.classList.add('list-group-item', 'd-flex', 'justify-content-between', 'align-items-center');
    
    if (player.isReady) {
      playerItem.classList.add('player-ready-indicator');
    }
    
    playerItem.textContent = player.name;
    
    // Show admin indicator
    if (player.id === gameState.adminId) {
      const badge = document.createElement('span');
      badge.classList.add('badge', 'bg-primary');
      badge.textContent = 'Host';
      playerItem.appendChild(badge);
    }
    
    // Show ready indicator
    if (player.isReady) {
      const readyBadge = document.createElement('span');
      readyBadge.classList.add('badge', 'bg-success', 'ms-2');
      readyBadge.textContent = 'Ready';
      playerItem.appendChild(readyBadge);
    }
    
    playerList.appendChild(playerItem);
  });
  
  // Update ready status after updating player list
  updateReadyStatus();
}

// Create a room
function createRoom() {
  const playerName = document.getElementById('player-name').value.trim();
  if (!playerName) {
    showError('Please enter your name');
    return;
  }
  
  const roomId = generateRoomId();
  console.log(`Creating room: ${roomId}`);
  
  // Save player info to game state
  gameState.playerName = playerName;
  gameState.roomId = roomId;
  gameState.isAdmin = true; // Creator is admin
  
  // Join the room
  socket.emit('joinRoom', {
    roomId: roomId,
    playerName: playerName,
    timeLimit: gameState.timeLimit
  });
  
  // Show the lobby screen
  showScreen('lobby');
  
  // Update room ID display
  document.getElementById('room-id-display').innerText = roomId;
  document.getElementById('player-name-display').innerText = playerName;
  
  // Initialize ready status
  gameState.isReady = false;
  updateReadyStatus();
}

// Join an existing room
function joinRoom() {
  const playerName = document.getElementById('player-name').value.trim();
  const roomId = document.getElementById('room-id').value.trim().toUpperCase();
  
  if (!playerName) {
    showError('Please enter your name');
    return;
  }
  
  if (!roomId) {
    showError('Please enter a room ID');
    return;
  }
  
  console.log(`Joining room: ${roomId}`);
  
  // Save player info to game state
  gameState.playerName = playerName;
  gameState.roomId = roomId;
  gameState.isAdmin = false; // Joiner is not admin by default
  
  // Join the room
  socket.emit('joinRoom', {
    roomId: roomId,
    playerName: playerName
  });
  
  // Show the lobby screen
  showScreen('lobby');
  
  // Update room ID display
  document.getElementById('room-id-display').innerText = roomId;
  document.getElementById('player-name-display').innerText = playerName;
  
  // Initialize ready status
  gameState.isReady = false;
  updateReadyStatus();
}

// Function to display categories for a given letter
function displayCategories(letter) {
  const categoriesGrid = document.querySelector('.categories-grid');
  if (!categoriesGrid) {
    console.error('Categories grid not found');
    return;
  }
  
  // Clear existing categories
  categoriesGrid.innerHTML = '';
  
  // For each category, create an input field
  gameState.categories.forEach(category => {
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';
    
    const label = document.createElement('label');
    label.textContent = category;
    formGroup.appendChild(label);
    
    const input = document.createElement('input');
    input.type = 'text';
    input.name = category;
    input.className = 'answer-input';
    input.placeholder = `${category} with ${letter}...`;
    input.setAttribute('autocomplete', 'off');
    
    categoryGroup.appendChild(label);
    categoryGroup.appendChild(input);
    categoriesGrid.appendChild(categoryGroup);
  });
} 