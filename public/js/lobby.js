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
            
            // Set up a timeout for client-side fallback in case server doesn't respond
            // This is a TEMPORARY FIX for server issues - remove once server is properly responding
            const ROUND_START_FALLBACK_TIMEOUT = 1000; // ms to wait for server response
            
            if (gameState.startRoundFallbackTimeout) {
                clearTimeout(gameState.startRoundFallbackTimeout);
            }
            
            gameState.startRoundFallbackTimeout = setTimeout(() => {
                console.log("[FALLBACK] No server response after startRound message. Starting round locally.");
                
                // Import required functions that would normally be called by socket.js when handling 'roundStarted'
                import('./game.js').then(gameModule => {
                    // Generate a random letter
                    const letters = 'ABCDEFGHIJKLMNOPRSTUVWZ'; // Exclude Q, X, Y
                    const randomLetter = letters[Math.floor(Math.random() * letters.length)];
                    
                    // Update gameState
                    gameState.currentLetter = randomLetter;
                    gameState.submitted = false;
                    
                    // Set up the game UI
                    console.log(`[FALLBACK] Setting up game with letter: ${randomLetter}`);
                    gameModule.setupCategoriesForm(randomLetter);
                    gameModule.startTimer(gameState.timeLimit || 60);
                    
                    // Switch to game screen
                    import('./dom.js').then(domModule => {
                        domModule.showScreen('game');
                        console.log("[FALLBACK] Game screen shown with local round start");
                    });
                });
            }, ROUND_START_FALLBACK_TIMEOUT);
        };
    }

    if (readyBtn) {
        readyBtn.onclick = () => {
            // Toggle ready state
            const newState = !gameState.isReady;
            console.log("Ready button clicked. New state:", newState);
            
            // Send message to server
            const message = { type: 'playerReady', isReady: newState };
            window.gameSocket.send(JSON.stringify(message));

            // Set up a timeout for client-side fallback in case server doesn't respond
            // This is a TEMPORARY FIX for server issues - remove once server is properly responding
            const CLIENT_FALLBACK_TIMEOUT = 500; // ms to wait for server response before local update
            
            if (gameState.readyFallbackTimeout) {
                clearTimeout(gameState.readyFallbackTimeout);
            }
            
            gameState.readyFallbackTimeout = setTimeout(() => {
                console.log("[FALLBACK] No server response after playerReady message. Applying local update.");
                
                // Update local state
                gameState.isReady = newState;
                
                // Find current player in player list and update their ready state
                const currentPlayer = gameState.players.find(p => p.id === window.gameSocket?.id);
                if (currentPlayer) {
                    currentPlayer.isReady = newState;
                    
                    // Manually count ready players and explicitly update readyCount
                    const readyPlayers = gameState.players.filter(p => p.isReady).length;
                    gameState.readyCount = readyPlayers;
                    
                    // Standard UI updates via helper functions
                    updateReadyStatus();
                    updatePlayerList();
                    updateButtonStates();
                    
                    // ENHANCED: Direct DOM updates for critical UI elements
                    // Update ready count display
                    const readyCountEl = DOM.get('ready-count');
                    const totalPlayersEl = DOM.get('total-players');
                    if(readyCountEl) readyCountEl.textContent = readyPlayers;
                    if(totalPlayersEl) totalPlayersEl.textContent = gameState.players.length;
                    
                    // Update Ready button text and style
                    if (readyBtn) {
                        readyBtn.textContent = gameState.isReady ? "I'm NOT Ready" : "I'm Ready";
                        readyBtn.classList.toggle('btn-outline-success', !gameState.isReady);
                        readyBtn.classList.toggle('btn-outline-warning', gameState.isReady);
                    }
                    
                    // Update Start Game button enabled state
                    const startGameBtn = DOM.get('start-game-btn');
                    const universalStartBtn = DOM.get('universal-start-btn');
                    const canStart = readyPlayers >= 1; // For single player, 1 ready is enough
                    
                    if (startGameBtn) startGameBtn.disabled = !canStart;
                    if (universalStartBtn) universalStartBtn.disabled = !canStart;
                    
                    console.log("[FALLBACK] Local gameState updated with direct UI updates:", { 
                        isReady: gameState.isReady, 
                        readyCount: readyPlayers,
                        players: gameState.players.length,
                        uiUpdated: true
                    });
                }
            }, CLIENT_FALLBACK_TIMEOUT);
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