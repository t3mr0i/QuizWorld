/**
 * lobby.js
 * Logic related to the game lobby screen.
 */

import { gameState, CATEGORIES as DEFAULT_CATEGORIES } from './state.js';
import { DOM } from './dom.js';
import { updateAdminControls, updateButtonStates, updateJoinButtonText, updateReadyStatus, updatePlayerList } from './ui.js'; // Import UI update functions

// Assumes 'socket' is available globally via window.gameSocket

// Sets up the dynamic text for the Join/Create button on the welcome screen
export function setupDynamicJoinButton() {
    const roomIdInput = DOM.get('room-id');
    if (roomIdInput) {
        roomIdInput.addEventListener('input', updateJoinButtonText);
        // Initial call to set correct text based on potential prefilled value (e.g., from URL)
        updateJoinButtonText();
    } else {
        console.warn("Room ID input not found, can't set up dynamic join button text.");
    }
}

// Initializes category management UI (list, add/remove buttons)
export function initializeCategoryManagement() {
    const categoryListContainer = DOM.get('categoryList');
    const addCategoryBtn = DOM.get('add-category-btn');
    const newCategoryInput = DOM.get('new-category-input');
    const categoryTemplate = DOM.get('category-item-template');

    if (!categoryListContainer || !addCategoryBtn || !newCategoryInput || !categoryTemplate) {
        console.error("Category management elements not found!");
        return;
    }

    // Function to render the current list of categories
    const renderList = () => {
        categoryListContainer.innerHTML = ''; // Clear existing
        gameState.categories.forEach(category => {
            const templateClone = categoryTemplate.content.cloneNode(true);
            const categoryItem = templateClone.querySelector('.category-item');
            const nameSpan = templateClone.querySelector('.category-name');
            const removeBtn = templateClone.querySelector('.category-remove');

            if (!categoryItem || !nameSpan || !removeBtn) return; // Skip if template is wrong

            nameSpan.textContent = category;
            removeBtn.disabled = !gameState.isAdmin; // Only admin can remove

            removeBtn.onclick = () => {
                if (!gameState.isAdmin) return;
                gameState.categories = gameState.categories.filter(c => c !== category);
                renderList(); // Re-render the list
                // Send update to server
                window.gameSocket?.send(JSON.stringify({ type: 'updateCategories', categories: gameState.categories }));
            };

            categoryListContainer.appendChild(templateClone);
        });
        // Disable add/remove if not admin
        addCategoryBtn.disabled = !gameState.isAdmin;
        newCategoryInput.disabled = !gameState.isAdmin;
        updateAdminControls(); // Ensure overall admin control visibility is correct
    };

    // Add category button listener
    addCategoryBtn.onclick = () => {
        if (!gameState.isAdmin) return;
        const newCategory = newCategoryInput.value.trim();
        if (newCategory && !gameState.categories.includes(newCategory)) {
            gameState.categories.push(newCategory);
            newCategoryInput.value = ''; // Clear input
            renderList(); // Re-render
            // Send update to server
            window.gameSocket?.send(JSON.stringify({ type: 'updateCategories', categories: gameState.categories }));
        }
    };
    
    // Allow adding category with Enter key
    newCategoryInput.onkeypress = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevent form submission if it's inside a form
            addCategoryBtn.click();
        }
    };

    // Initial render
    // Ensure categories in gameState are up-to-date if joining a room
    if (!gameState.categories || gameState.categories.length === 0) {
        gameState.categories = [...DEFAULT_CATEGORIES]; // Use defaults if empty
    }
    renderList();
}

// Renders the initial category list in the lobby (before editing)
export function renderCategoryList() {
    // This function might be redundant if initializeCategoryManagement handles rendering
    // Or it could be simplified just to trigger the renderList inside initializeCategoryManagement
    initializeCategoryManagement(); // Re-running init should re-render with current gameState.categories
}


// Sets up listeners for common game control buttons (Start, Ready, etc.)
export function setupGameControls() {
    const startGameBtn = DOM.get('start-game-btn'); // Admin start
    const readyBtn = DOM.get('ready-btn');
    const nextRoundBtn = DOM.get('next-round-btn');
    const copyLinkBtn = DOM.get('copy-link-btn');
    const universalStartBtn = DOM.get('universal-start-btn'); // Client-side start

    if (startGameBtn) {
        startGameBtn.onclick = () => {
            if (!gameState.isAdmin) {
                showError("Only the host can start the game.");
                return;
            }
            console.log("Admin start button clicked");
            
            // Send startRound message to server
            window.gameSocket?.send(JSON.stringify({ type: 'startRound' }));
            
            // WORKAROUND: Manually start game locally since server isn't responding
            console.log("SIMPLEST-WORKAROUND: Manually starting game locally");
            
            try {
                // Generate a random letter
                const letters = "ABCDEFGHIJKLMNOPRSTUVWZ"; // Exclude Q, X, Y
                const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                gameState.currentLetter = randomLetter;
                console.log(`SIMPLEST-WORKAROUND: Using random letter: ${randomLetter}`);
                
                // 1. Switch to game screen - ULTRA DIRECT approach matching app's design
                console.log("SIMPLEST-WORKAROUND: About to switch screens (ULTRA DIRECT)");
                
                // Get the real screens from DOM
                const welcomeScreen = document.getElementById('welcome-screen');
                const lobbyScreen = document.getElementById('lobby-screen');
                const gameScreen = document.getElementById('game-screen');
                const resultsScreen = document.getElementById('results-screen');
                
                console.log("ULTRA: Found screens:", { 
                    welcomeScreen: !!welcomeScreen, 
                    lobbyScreen: !!lobbyScreen, 
                    gameScreen: !!gameScreen, 
                    resultsScreen: !!resultsScreen 
                });
                
                // Use the exact same class manipulation the app uses
                if (welcomeScreen) {
                    welcomeScreen.classList.remove('active');
                    welcomeScreen.classList.add('hidden');
                }
                
                if (lobbyScreen) {
                    lobbyScreen.classList.remove('active');
                    lobbyScreen.classList.add('hidden');
                }
                
                if (resultsScreen) {
                    resultsScreen.classList.remove('active');
                    resultsScreen.classList.add('hidden');
                }
                
                if (gameScreen) {
                    gameScreen.classList.remove('hidden');
                    gameScreen.classList.add('active');
                    console.log("ULTRA: Applied exact same class changes as app's showScreen function");
                }
                
                // 2. Set up form with direct DOM manipulation
                const categoriesGrid = document.querySelector('#answers-form .categories-grid');
                if (categoriesGrid) {
                    categoriesGrid.innerHTML = ''; // Clear previous form
                    const categories = gameState.categories || ['Stadt', 'Land', 'Fluss'];
                    
                    categories.forEach(category => {
                        const html = `
                            <div class="category-group">
                                <label for="answer-${category.toLowerCase().replace(/\s+/g, '-')}">${category}</label>
                                <input type="text" 
                                    id="answer-${category.toLowerCase().replace(/\s+/g, '-')}" 
                                    name="${category}" 
                                    autocomplete="off" 
                                    placeholder="${category} starting with ${randomLetter}...">
                            </div>
                        `;
                        categoriesGrid.insertAdjacentHTML('beforeend', html);
                    });
                    console.log("SIMPLEST-WORKAROUND: Manual form setup complete");
                }
                
                // 3. Set up timer with direct DOM manipulation
                const timerElement = document.getElementById('timer');
                if (timerElement) {
                    let timeRemaining = gameState.timeLimit || 60;
                    timerElement.textContent = timeRemaining;
                    
                    if (gameState.timerInterval) {
                        clearInterval(gameState.timerInterval);
                    }
                    
                    gameState.timerInterval = setInterval(() => {
                        timeRemaining--;
                        timerElement.textContent = timeRemaining;
                        
                        if (timeRemaining <= 0) {
                            clearInterval(gameState.timerInterval);
                            gameState.timerInterval = null;
                        }
                    }, 1000);
                    console.log("SIMPLEST-WORKAROUND: Manual timer started");
                }
                
                // 4. Set up letter display
                const letterDisplay = document.getElementById('current-letter');
                if (letterDisplay) {
                    letterDisplay.textContent = randomLetter;
                    console.log("SIMPLEST-WORKAROUND: Updated letter display");
                }
                
                // 5. Enable the submit button
                const submitBtn = document.getElementById('submit-btn');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit Answers';
                    console.log("SIMPLEST-WORKAROUND: Enabled submit button");
                }
                
            } catch (error) {
                console.error("SIMPLEST-WORKAROUND ERROR:", error);
            }
            
            // Temporarily disable the button to prevent spam clicks
            startGameBtn.disabled = true;
            setTimeout(() => {
                startGameBtn.disabled = false;
            }, 1000);
        };
    }

    if (readyBtn) {
        readyBtn.onclick = () => {
            // Toggle ready state
            const newState = !gameState.isReady;
            console.log("Ready button clicked. New state:", newState);
            console.log("Ready button clicked. Current gameState.isReady BEFORE toggle:", gameState.isReady);
            
            // HARD RESET - DIRECT BUTTON TEXT CHANGE
            readyBtn.textContent = newState ? "I'm NOT Ready" : "I'm Ready";
            readyBtn.classList.toggle('btn-outline-success', !newState);
            readyBtn.classList.toggle('btn-outline-warning', newState);
            
            // Send message to server
            const message = { type: 'playerReady', isReady: newState };
            console.log("Ready button clicked. Sending message:", JSON.stringify(message));
            window.gameSocket.send(JSON.stringify(message));
            
            // Force update local state
            gameState.isReady = newState;
            console.log("FORCE-UPDATE: Set gameState.isReady to", newState);
            
            // Update player in array directly
            const playerIndex = gameState.players.findIndex(p => p && p.id === window.gameSocket?.id);
            if (playerIndex !== -1) {
                gameState.players[playerIndex].isReady = newState;
                gameState.readyCount = gameState.players.filter(p => p && p.isReady).length;
                console.log("FORCE-UPDATE: Updated player record and readyCount:", gameState.readyCount);
            }
            
            // Update UI displays
            const readyCountElement = document.getElementById('ready-count');
            if (readyCountElement) {
                readyCountElement.textContent = gameState.readyCount;
                console.log("FORCE-UPDATE: Updated ready-count display to", gameState.readyCount);
            }
            
            // Update the start button and waiting message
            updateButtonStates();
            
            // Also update the waiting message
          
            // Enable the start button if enough players are ready
            const startGameBtn = document.getElementById('start-game-btn');
            if (startGameBtn) {
                const totalPlayers = gameState.players.length;
                const requiredReady = totalPlayers <= 1 ? totalPlayers : (totalPlayers === 2 ? 2 : Math.ceil(totalPlayers / 2));
                const canStart = gameState.readyCount >= requiredReady;
                startGameBtn.disabled = !canStart;
                console.log("FORCE-UPDATE: Updated start button state to:", !startGameBtn.disabled);
            }
            
            // Temporarily disable the button to prevent spam clicks
            readyBtn.disabled = true;
            setTimeout(() => {
                readyBtn.disabled = false;
                console.log("Ready button re-enabled. Current gameState.isReady after timeout:", gameState.isReady);
            }, 500);
        };
    }

    if (universalStartBtn) {
        universalStartBtn.onclick = () => {
             console.log("Universal start button clicked");
             startNewRound(); // Call function from game.js (needs import)
        };
    }

    if (nextRoundBtn) {
        nextRoundBtn.onclick = () => {
             if (!gameState.isAdmin && !window.CONFIG?.ALLOW_ANYONE_TO_START) {
                 // If not admin and client-side start isn't allowed, just go back to lobby view
                 // (assuming server will handle actual state reset if needed)
                 showScreen('lobby');
                 return;
             }
            console.log("Next Round / Play Again button clicked");
            // In client-side mode, this might just reset local state and go to lobby
            // In server mode, admin should trigger the actual next round / reset
            if(gameState.clientSideMode || window.CONFIG?.ALLOW_ANYONE_TO_START){
                 showScreen('lobby');
                 // Minimal local reset, rely on server/next round start for full reset
                 gameState.currentLetter = '';
                 gameState.isReady = false;
                 updatePlayerList();
                 updateReadyStatus();
            } else if (gameState.isAdmin) {
                 window.gameSocket?.send(JSON.stringify({ type: 'startRound' })); // Admin starts next round
                 // Or maybe send a 'resetGame' message?
            }
        };
    }

    if (copyLinkBtn) {
        copyLinkBtn.onclick = () => {
            const roomId = gameState.roomId || DOM.get('display-room-id')?.textContent || '';
            if (!roomId) {
                showError("Cannot copy link: Room ID not found.");
                return;
            }
            const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
            navigator.clipboard.writeText(url).then(() => {
                const originalHTML = copyLinkBtn.innerHTML;
                copyLinkBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
                copyLinkBtn.disabled = true;
                setTimeout(() => {
                    copyLinkBtn.innerHTML = originalHTML;
                    copyLinkBtn.disabled = false;
                }, 1500);
            }).catch(err => {
                showError("Failed to copy link to clipboard.");
                console.error('Clipboard write failed:', err);
            });
        };
    }

    // Initial update of button states based on current gameState
    updateButtonStates();
} 