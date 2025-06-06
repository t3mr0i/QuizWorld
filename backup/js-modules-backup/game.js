/**
 * game.js
 * Game round logic: timer, answer submission, form setup.
 */

import { gameState, CATEGORIES as DEFAULT_CATEGORIES } from './state.js';
import { DOM } from './dom.js';
import { showError } from './dom.js'; // Assuming showError is in dom.js now

// Assumes 'socket' is available globally via window.gameSocket

// Function to start a new round (called by admin or universally)
export function startNewRound() {
     // Check if the client is configured to allow anyone to start
    const allowClientSideStart = window.CONFIG?.ALLOW_ANYONE_TO_START || gameState.clientSideMode;

    if (gameState.isAdmin || allowClientSideStart) {
        console.log('[game.js] Starting new round...');
        // If client-side mode is enabled, we might simulate the server call
        // or just directly manipulate local state if server isn't involved.
        // For now, assume we always tell the server (if connected)
        if (window.gameSocket && typeof window.gameSocket.send === 'function') {
             try {
                 window.gameSocket.send(JSON.stringify({ type: 'startRound' }));
                 console.log('[game.js] Sent startRound message to server.');
             } catch (error) {
                 console.error('[game.js] Error sending startRound message:', error);
                 showError("Could not start round. Connection error?");
             }
        } else if (allowClientSideStart) {
             // --- CLIENT-SIDE FALLBACK (if no connection or forced client-side) ---
             console.warn('[game.js] CLIENT-SIDE MODE: Simulating round start locally.');
             // Generate a random letter
             const letters = 'ABCDEFGHIJKLMNOPRSTUVWZ'; // Exclude Q, X, Y
             const randomLetter = letters[Math.floor(Math.random() * letters.length)];
             // Simulate the roundStarted message
             handleRoundStarted({ // Assuming handleRoundStarted is available globally or imported
                 type: 'roundStarted',
                 letter: randomLetter,
                 timeLimit: gameState.timeLimit, // Use current time limit
                 categories: gameState.categories // Use current categories
             });
        } else {
             showError("Cannot start round: Not connected to server.");
        }
    } else {
        console.warn('[game.js] Non-admin attempted to start round without client-side override.');
        showError("Only the host can start the game.");
    }
}

// Sets up the categories form for the current round
export function setupCategoriesForm(letter) {
    const categoriesGrid = DOM.query('#answers-form .categories-grid');
    if (!categoriesGrid) {
        console.error("Categories grid not found!");
        return;
    }

    console.log(`[game.js] Setting up categories form for letter: ${letter}`);
    categoriesGrid.innerHTML = ''; // Clear previous form
    const categories = gameState.categories.length > 0 ? gameState.categories : DEFAULT_CATEGORIES;

    categories.forEach(category => {
        const categoryGroup = DOM.create('div', { className: 'category-group' });

        const label = DOM.create('label', {
            htmlFor: `answer-${category.toLowerCase().replace(/\s+/g, '-')}`,
            textContent: category
        });

        const input = DOM.create('input', {
            type: 'text',
            id: `answer-${category.toLowerCase().replace(/\s+/g, '-')}`,
            name: category,
            autocomplete: 'off',
            placeholder: `${category} starting with ${letter}...`,
            required: true // Make inputs required? Optional.
        });

        categoryGroup.appendChild(label);
        categoryGroup.appendChild(input);
        categoriesGrid.appendChild(categoryGroup);
    });

    // Reset submit button state
    const submitBtn = DOM.get('submit-btn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Answers';
    }

    // Focus the first input field
    const firstInput = categoriesGrid.querySelector('input');
    if (firstInput) {
        // Use setTimeout to ensure focus works after potential DOM updates/transitions
        setTimeout(() => firstInput.focus(), 100);
    }
}

// Starts the game timer
export function startTimer(duration) {
    console.log(`[game.js] Starting timer for ${duration} seconds.`);
    // Clear existing timer if any
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }

    const timerElement = DOM.get('timer');
    if (!timerElement) {
        console.error("Timer element not found!");
        return;
    }

    let timeRemaining = duration;
    timerElement.textContent = timeRemaining;
    timerElement.classList.remove('timer-warning', 'timer-danger'); // Reset classes

    // Store the timer reference in gameState for external access
    gameState.currentTimeRemaining = timeRemaining;

    gameState.timerInterval = setInterval(() => {
        timeRemaining--;
        gameState.currentTimeRemaining = timeRemaining;
        timerElement.textContent = timeRemaining;

        // Add visual indication for time running out
        if (timeRemaining <= 10 && timeRemaining > 5) {
            timerElement.classList.add('timer-warning');
        } else if (timeRemaining <= 5) {
            timerElement.classList.remove('timer-warning');
            timerElement.classList.add('timer-danger');
        }

        if (timeRemaining <= 0) {
            clearInterval(gameState.timerInterval);
            gameState.timerInterval = null;
            console.log("[game.js] Timer finished.");
            // Auto-submit answers if not already submitted
            if (!gameState.submitted) {
                console.log("[game.js] Auto-submitting answers as timer expired.");
                submitAnswers();
            }
        }
    }, 1000);
}

// Function to handle timer reduction from server
export function handleTimerReduction(data) {
    const { timeReduction, newTimeRemaining, submittedPlayer } = data;
    
    console.log(`[game.js] Timer reduced by ${timeReduction}s due to ${submittedPlayer}'s submission. New time: ${newTimeRemaining}s`);
    
    // Update the current time remaining
    gameState.currentTimeRemaining = newTimeRemaining;
    
    // Update the timer display immediately
    const timerElement = DOM.get('timer');
    if (timerElement) {
        timerElement.textContent = newTimeRemaining;
        
        // Add a visual effect to show the time reduction
        timerElement.classList.add('timer-reduced');
        setTimeout(() => {
            timerElement.classList.remove('timer-reduced');
        }, 1000);
        
        // Update warning/danger classes based on new time
        if (newTimeRemaining <= 10 && newTimeRemaining > 5) {
            timerElement.classList.add('timer-warning');
            timerElement.classList.remove('timer-danger');
        } else if (newTimeRemaining <= 5) {
            timerElement.classList.remove('timer-warning');
            timerElement.classList.add('timer-danger');
        } else {
            timerElement.classList.remove('timer-warning', 'timer-danger');
        }
    }
    
    // Show a notification to players
    showTimerReductionNotification(timeReduction, submittedPlayer);
}

// Function to show timer reduction notification
function showTimerReductionNotification(timeReduction, submittedPlayer) {
    // Create a temporary notification element
    const notification = DOM.create('div', {
        className: 'timer-reduction-notification',
        textContent: `⏰ ${submittedPlayer} submitted! Time reduced by ${timeReduction}s`
    });
    
    // Add to the game screen
    const gameScreen = DOM.get('game-screen');
    if (gameScreen) {
        gameScreen.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

// Submits the player's answers
export function submitAnswers() {
    if (gameState.submitted) {
        console.log("[game.js] Answers already submitted.");
        return;
    }

    console.log("[game.js] Submitting answers...");
    const answerInputs = DOM.queryAll('#answers-form .category-group input');
    const answers = {};

    answerInputs.forEach(input => {
        answers[input.name] = input.value.trim();
        input.disabled = true; // Disable input after submission
    });

    const submitBtn = DOM.get('submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitted';
    }

    gameState.submitted = true;
    gameState.lastSubmitTime = Date.now();

    // --- Client-Side Validation Fallback --- 
    // If in client-side mode or maybe just as a general fallback,
    // set a timeout. If the server doesn't send results within X seconds,
    // process results locally.
    if (gameState.clientSideMode || window.CONFIG?.ENABLE_CLIENT_VALIDATION) { 
        const VALIDATION_TIMEOUT = 15000; // 15 seconds
        console.log(`[game.js] CLIENT-SIDE MODE: Setting validation timeout (${VALIDATION_TIMEOUT}ms)`);
        clearTimeout(gameState.validationTimeoutId); // Clear any previous timeout
        gameState.validationTimeoutId = setTimeout(() => {
            console.warn(`[game.js] CLIENT-SIDE MODE: Server results timeout reached after ${VALIDATION_TIMEOUT}ms. Processing locally.`);
            processLocalResults(); // Assume processLocalResults is defined/imported
            gameState.validationTimeoutId = null;
        }, VALIDATION_TIMEOUT);
    }

    // Send answers to server (if connected)
    console.log('[game.js] Preparing to send submitAnswers. Checking socket state...'); // <-- ADD LOG
    // Use the 'connected' property from GamePartySocket instance
    if (window.gameSocket && typeof window.gameSocket.send === 'function' && window.gameSocket.connected) {
         // ADD MORE DETAILED LOGGING HERE - Use the correct property now
         console.log(`[game.js] Socket details before sending: ID=${window.gameSocket.id}, Connected=${window.gameSocket.connected}`);

         try {
             const payload = {
                type: 'submitAnswers',
                answers: answers
             };
             console.log('[game.js] Sending payload:', JSON.stringify(payload)); // Log the exact payload
             window.gameSocket.send(JSON.stringify(payload));
             console.log("[game.js] Sent submitAnswers message to server.");
         } catch (error) {
              console.error('[game.js] Error sending submitAnswers message:', error);
              showError("Could not submit answers. Connection error?");
              // Re-enable form potentially?
              if (submitBtn) submitBtn.disabled = false;
              answerInputs.forEach(input => input.disabled = false);
              gameState.submitted = false; // Reset submitted flag
         }

    } else { // Combined the else-if and else
         // Log why sending failed
         console.error(`[game.js] Cannot send submitAnswers. Socket exists: ${!!window.gameSocket}, send function exists: ${typeof window.gameSocket?.send === 'function'}, Is connected: ${window.gameSocket?.connected}`);
         // Only show error if not in client-side mode (where timeout handles it)
         if (!gameState.clientSideMode) {
             showError("Cannot submit answers: Not connected to server.");
             // Re-enable form
             if (submitBtn) submitBtn.disabled = false;
             answerInputs.forEach(input => input.disabled = false);
             gameState.submitted = false;
         }
    }
}

// --- Placeholder for Client-Side Results Processing ---
// This would involve comparing answers against rules/other players (if possible locally)
export function processLocalResults() {
    console.log("[game.js] CLIENT-SIDE MODE: processLocalResults called.");
    // TODO: Implement client-side scoring logic
    // 1. Get current player's answers (already in `answers` variable in submitAnswers context, might need refactoring)
    // 2. Apply basic scoring rules (e.g., 10 points if valid and unique, 5 if valid but not unique, 0 if invalid/empty)
    // 3. Construct a results data structure similar to the server's
    // 4. Call displayRoundResults with the locally generated data

    // Example structure:
    const localScores = {}; // { category: { playerId: { answer, score, explanation } } }
    const playerAnswers = {}; // Get answers submitted by this player
    DOM.queryAll('#answers-form .category-group input').forEach(input => {
        playerAnswers[input.name] = input.value.trim();
    });

    const currentPlayerId = window.gameSocket?.id || 'localPlayer';
    const currentCategories = gameState.categories;
    let totalScore = 0;

    currentCategories.forEach(cat => {
        const answer = playerAnswers[cat] || '-';
        let score = 0;
        let explanation = 'Invalid (client-side)';

        if (answer !== '-' && answer.length > 0 && answer.toUpperCase().startsWith(gameState.currentLetter)) {
            score = 5; // Default valid score
            explanation = 'Valid (client-side)';
            // Uniqueness check would require other player data, difficult client-side
        }

        if (!localScores[cat]) localScores[cat] = {};
        localScores[cat][currentPlayerId] = { answer, score, explanation };
        totalScore += score;
    });

    // Update local player score in gameState
    const playerIndex = gameState.players.findIndex(p => p.id === currentPlayerId);
    if (playerIndex !== -1) {
        gameState.players[playerIndex].score = (gameState.players[playerIndex].score || 0) + totalScore; // Add to existing score
    }

    const resultsData = {
        type: 'roundResults',
        scores: localScores,
        players: gameState.players, // Send updated players list
        categories: currentCategories
    };

    console.log("[game.js] CLIENT-SIDE MODE: Generated local results:", resultsData);
    
    // ULTRA DIRECT screen switching to match our other fixes
    console.log("[game.js] DIRECT WORKAROUND: Switching to results screen");
    try {
        // 1. Import necessary functions and modules
        const displayRoundResults = typeof window.displayRoundResults === 'function' 
            ? window.displayRoundResults 
            : (typeof displayRoundResults === 'function' ? displayRoundResults : null);
            
        // 2. First try the direct approach with UI function if available
        if (typeof displayRoundResults === 'function') {
            displayRoundResults(resultsData);
            console.log("[game.js] DIRECT WORKAROUND: Called displayRoundResults function");
        } else {
            console.warn("[game.js] DIRECT WORKAROUND: displayRoundResults function not available, using manual approach");
            // TODO: Implement minimal display of results if needed
        }
        
        // 3. Ultra direct screen switching to match our fix pattern
        const welcomeScreen = document.getElementById('welcome-screen');
        const lobbyScreen = document.getElementById('lobby-screen');
        const gameScreen = document.getElementById('game-screen');
        const resultsScreen = document.getElementById('results-screen');
        
        // Hide all other screens
        if (welcomeScreen) {
            welcomeScreen.classList.remove('active');
            welcomeScreen.classList.add('hidden');
        }
        
        if (lobbyScreen) {
            lobbyScreen.classList.remove('active');
            lobbyScreen.classList.add('hidden');
        }
        
        if (gameScreen) {
            gameScreen.classList.remove('active');
            gameScreen.classList.add('hidden');
        }
        
        // Show results screen
        if (resultsScreen) {
            resultsScreen.classList.remove('hidden');
            resultsScreen.classList.add('active');
            console.log("[game.js] DIRECT WORKAROUND: Switched to results screen directly");
        } else {
            console.error("[game.js] DIRECT WORKAROUND: Results screen not found in DOM!");
        }
    } catch (error) {
        console.error("[game.js] DIRECT WORKAROUND ERROR in processLocalResults:", error);
    }
}
