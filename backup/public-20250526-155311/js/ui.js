/**
 * ui.js
 * UI update functions and general UI logic.
 */

import { gameState, CATEGORIES } from './state.js';
import { DOM, screens } from './dom.js';

// This module assumes 'socket' is globally available via window.gameSocket
// or imported if socket.js is also refactored to export it.

/**
 * Updates the player list display with current game state
 */
export function updatePlayerList() {
    const playerList = DOM.get('player-list');
    if (!playerList) {
        console.warn('[ui.js] Player list element not found');
        return;
    }

    const players = gameState.players || [];
    const adminId = gameState.adminId;
    const currentSocketId = window.gameSocket?.id;

    console.log('[ui.js] Updating player list:', {
        playerCount: players.length,
        adminId,
        currentSocketId
    });

    // Sort players: Admin first, then current player, then alphabetically
    const sortedPlayers = [...players].sort((a, b) => {
        if (a.id === adminId && b.id !== adminId) return -1;
        if (a.id !== adminId && b.id === adminId) return 1;
        if (a.id === currentSocketId && b.id !== currentSocketId) return -1;
        if (a.id !== currentSocketId && b.id === currentSocketId) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });

    // Clear and rebuild player list
    playerList.innerHTML = '';
    playerList.setAttribute('data-count', `${sortedPlayers.length} players`);
    
    if (sortedPlayers.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'player-item player-empty';
        emptyItem.innerHTML = '<strong style="color: #666;">No players connected</strong>';
        playerList.appendChild(emptyItem);
    } else {
        sortedPlayers.forEach(player => {
            if (!player?.id) return;
            
            const li = document.createElement('li');
            li.className = 'player-item';
            
            // Add player-specific classes
            if (player.id === currentSocketId) li.classList.add('current-player');
            if (player.id === adminId) li.classList.add('admin-player');
            if (player.isReady) li.classList.add('ready');
            
            // Create player display with badges
            const playerHTML = createPlayerHTML(player, currentSocketId, adminId);
            li.innerHTML = playerHTML;
            playerList.appendChild(li);
        });
    }

    // Update related UI elements
    updateWaitingMessage();
    updateReadyStatus();
    updateButtonStates();
    
    console.log(`[ui.js] Player list updated with ${sortedPlayers.length} players`);
}

/**
 * Creates HTML for a single player item
 */
function createPlayerHTML(player, currentSocketId, adminId) {
    const isCurrentPlayer = player.id === currentSocketId;
    const isAdmin = player.id === adminId;
    const isReady = player.isReady === true; // Explicit boolean check
    const hasSubmitted = gameState.currentLetter && player.submitted;
    
    const badges = [];
    if (isCurrentPlayer) badges.push('<span class="badge badge-you">You</span>');
    if (isAdmin) badges.push('<span class="badge badge-admin">Host</span>');
    if (isReady) badges.push('<span class="badge badge-ready">Ready</span>');
    if (hasSubmitted) badges.push('<span class="badge badge-submitted">Submitted</span>');
    
    console.log(`[ui.js] Creating player HTML for ${player.name}: isReady=${isReady}, isAdmin=${isAdmin}, isCurrentPlayer=${isCurrentPlayer}`);
    
    return `
        <div class="player-display ${isReady ? 'ready' : ''}">
            <span class="player-name">
                ${player.name || `Player (${player.id.substring(0,4)})`}
            </span>
            <div class="player-badges">
                ${badges.join('')}
            </div>
        </div>
    `;
}

/**
 * Updates the scores/leaderboard display
 */
export function updateScores() {
    const scoresList = DOM.get('scores-list');
    if (!scoresList) {
        console.warn('[ui.js] Scores list element not found');
        return;
    }

    const players = gameState.players || [];
    const currentSocketId = window.gameSocket?.id;

    // Clear and sort by score
    scoresList.innerHTML = '';
    const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

    sortedPlayers.forEach((player, index) => {
        const li = DOM.create('li', { className: 'player-item' });
        if (player.id === currentSocketId) li.classList.add('current-player');

        const rankDiv = DOM.create('div', { 
            className: `rank-badge rank-${index + 1}`, 
            textContent: (index + 1).toString() 
        });
        
        const nameDiv = DOM.create('div', { 
            className: 'player-name', 
            textContent: player.name || `Player ${player.id.substring(0,4)}` 
        });
        
        const scoreDiv = DOM.create('div', { 
            className: 'player-score', 
            textContent: `${player.score || 0} pts` 
        });

        if (player.id === currentSocketId) {
            nameDiv.appendChild(DOM.create('span', { 
                className: 'you-label', 
                textContent: ' (You)' 
            }));
        }

        li.appendChild(rankDiv);
        li.appendChild(nameDiv);
        li.appendChild(scoreDiv);
        scoresList.appendChild(li);
    });
}

/**
 * Updates the text of the main join/create button based on room ID input
 */
export function updateJoinButtonText() {
    const joinGameBtn = DOM.get('join-game-btn');
    const roomIdInput = DOM.get('room-id');
    
    if (!joinGameBtn || !roomIdInput) {
        console.warn('[ui.js] Join button or room ID input not found');
        return;
    }

    const hasRoomId = roomIdInput.value.trim() !== '';
    joinGameBtn.textContent = hasRoomId ? 'Join Game' : 'Create Game';
}

/**
 * Updates button states based on current game state
 */
export function updateButtonStates() {
    const startGameBtn = DOM.get('start-game-btn');
    const readyBtn = DOM.get('ready-btn');
    const universalStartBtn = DOM.get('universal-start-btn');

    if (!startGameBtn || !readyBtn || !universalStartBtn) {
        console.warn('[ui.js] Some lobby buttons not found');
        return;
    }

    const players = gameState.players || [];
    const totalPlayers = players.length;
    const readyPlayers = players.filter(p => p?.isReady).length;
    
    // Calculate required ready players
    const requiredReady = totalPlayers <= 1 ? totalPlayers : 
                         totalPlayers === 2 ? 2 : 
                         Math.ceil(totalPlayers / 2);
    const canStart = readyPlayers >= requiredReady;

    // Update admin start button
    startGameBtn.disabled = !canStart;
    const adminMsg = DOM.get('admin-message');
    if (adminMsg) {
        adminMsg.textContent = canStart ? 
            '' : 
            `Waiting for ${requiredReady - readyPlayers} more player(s) to be ready...`;
    }

    // Update universal start button
    const useUniversalStart = window.CONFIG?.ALLOW_ANYONE_TO_START || gameState.clientSideMode;
    universalStartBtn.style.display = useUniversalStart ? 'block' : 'none';
    universalStartBtn.disabled = !canStart;
    
    const universalHint = DOM.query('.footer-hint', universalStartBtn.parentElement);
    if (universalHint) {
        universalHint.style.display = useUniversalStart ? 'block' : 'none';
    }

    // Update ready button
    updateReadyButton(readyBtn);
}

/**
 * Updates the ready button state and text
 */
function updateReadyButton(readyBtn) {
    if (!readyBtn) return;
    
    const isReady = gameState.isReady;
    
    readyBtn.textContent = isReady ? "I'm NOT Ready" : "I'm Ready";
    readyBtn.classList.toggle('btn-outline-success', !isReady);
    readyBtn.classList.toggle('btn-outline-warning', isReady);
    
    console.log(`[ui.js] Ready button updated: ${readyBtn.textContent}`);
}

/**
 * Updates admin-specific controls visibility
 */
export function updateAdminControls() {
    const adminControls = DOM.get('admin-controls');
    const closeSessionBtn = DOM.get('close-session-btn');
    const isAdmin = gameState.isAdmin;

    console.log(`[ui.js] === ADMIN CONTROLS DEBUG ===`);
    console.log(`[ui.js] IsAdmin: ${isAdmin}`);
    console.log(`[ui.js] AdminId: ${gameState.adminId}`);
    console.log(`[ui.js] CurrentSocketId: ${window.gameSocket?.id}`);
    console.log(`[ui.js] AdminControls element found: ${!!adminControls}`);
    console.log(`[ui.js] CloseSessionBtn element found: ${!!closeSessionBtn}`);

    // Show/hide admin controls section
    if (adminControls) {
        if (isAdmin) {
            adminControls.style.display = 'block';
            adminControls.classList.add('visible');
            console.log('[ui.js] ✅ Admin controls shown (display: block, class: visible)');
        } else {
            adminControls.style.display = 'none';
            adminControls.classList.remove('visible');
            console.log('[ui.js] ❌ Admin controls hidden (display: none, class removed)');
        }
        
        // Log current state
        console.log(`[ui.js] AdminControls current classes: ${adminControls.className}`);
        console.log(`[ui.js] AdminControls current display: ${adminControls.style.display}`);
    } else {
        console.error('[ui.js] ❌ CRITICAL: admin-controls element not found in DOM!');
    }
    
    // Show/hide close session button
    if (closeSessionBtn) {
        closeSessionBtn.style.display = isAdmin ? 'inline-block' : 'none';
        closeSessionBtn.disabled = !isAdmin;
        console.log(`[ui.js] Close session button: ${isAdmin ? '✅ shown' : '❌ hidden'} (display: ${closeSessionBtn.style.display})`);
    } else {
        console.error('[ui.js] ❌ CRITICAL: close-session-btn element not found in DOM!');
    }

    console.log(`[ui.js] === END ADMIN CONTROLS DEBUG ===`);

    updateWaitingMessage();
}

/**
 * Displays round results in a structured table
 */
export function displayRoundResults(data) {
    console.log('[ui.js] Displaying round results:', data);

    const resultsTableBody = DOM.get('results-body');
    const resultsTitle = DOM.get('results-title');
    const resultLetter = DOM.get('result-letter');

    if (!resultsTableBody) {
        console.error('[ui.js] Results table body not found');
        return;
    }

    // Clear previous results
    resultsTableBody.innerHTML = '';
    
    if (resultsTitle) resultsTitle.textContent = 'Round Results';
    if (resultLetter && gameState.currentLetter) {
        resultLetter.textContent = gameState.currentLetter;
    }

    if (!data?.scores || !data?.players || !data?.categories) {
        resultsTableBody.innerHTML = '<tr><td colspan="4">Error: Incomplete results data received.</td></tr>';
        return;
    }

    const { scores: scoresByCategory, players, categories } = data;
    const currentSocketId = window.gameSocket?.id;

    // Create rows grouped by category
    categories.forEach((category, catIndex) => {
        // Category header
        const headerRow = DOM.create('tr', { className: 'category-header-row' });
        headerRow.appendChild(DOM.create('td', { 
            colSpan: 4, 
            innerHTML: `<h3>${category}</h3>` 
        }));
        resultsTableBody.appendChild(headerRow);

        // Player rows for this category
        players.forEach((player, playerIndex) => {
            const categoryScores = scoresByCategory[category] || {};
            const scoreData = categoryScores[player.id];
            
            const answer = scoreData?.answer || '-';
            const score = scoreData?.score ?? 0;
            const explanation = scoreData?.explanation || (answer === '-' ? 'No answer' : '-');

            const row = createResultRow(player, answer, score, explanation, currentSocketId);
            row.style.animationDelay = `${(catIndex * players.length + playerIndex) * 0.05}s`;
            resultsTableBody.appendChild(row);
        });
    });

    // Update leaderboard
    updateScores();
}

/**
 * Creates a single result row for the results table
 */
function createResultRow(player, answer, score, explanation, currentSocketId) {
    const row = DOM.create('tr');
    if (player.id === currentSocketId) row.classList.add('current-player-row');

    // Player name cell
    const nameCell = DOM.create('td', {}, [player.name || `Player ${player.id.substring(0,4)}`]);
    if (player.id === currentSocketId) {
        nameCell.innerHTML += ' <span class="you-label">(You)</span>';
    }

    // Answer cell
    const answerCell = DOM.create('td', { 
        className: `answer-cell score-${score > 0 ? 'valid' : 'invalid'}` 
    }, [answer]);

    // Score cell
    const scoreCell = DOM.create('td', { 
        className: `score-cell ${score > 0 ? 'valid-points' : 'invalid-points'}` 
    }, [score.toString()]);

    // Explanation cell
    const explanationCell = DOM.create('td', { 
        className: 'explanation-cell' 
    }, [explanation]);

    row.appendChild(nameCell);
    row.appendChild(answerCell);
    row.appendChild(scoreCell);
    row.appendChild(explanationCell);
    
    return row;
}

/**
 * Updates the waiting message based on current game state
 */
function updateWaitingMessage() {
    const waitingMessage = DOM.get('waiting-message');
    if (!waitingMessage) return;

    const playerCount = gameState.players?.length || 0;
    const isAdmin = gameState.isAdmin;
    const lobbyScreenActive = screens.lobby?.classList.contains('active');

    if (!lobbyScreenActive) {
        waitingMessage.style.display = 'none';
        return;
    }

    let message = '';
    
    if (playerCount <= 1) {
        message = isAdmin ? 
            'You can start playing alone whenever you\'re ready. Use the Start Game button.' : 
            'Waiting for the host to start the game.';
    } else {
        const readyPlayers = gameState.players.filter(p => p?.isReady).length;
        const requiredReady = playerCount <= 2 ? playerCount : Math.ceil(playerCount / 2);

        if (isAdmin) {
            message = readyPlayers >= requiredReady ?
                `Enough players are ready (${readyPlayers}/${playerCount})! Click START GAME below.` :
                `Waiting for more players to be ready (${readyPlayers}/${playerCount} ready, need ${requiredReady}).`;
        } else {
            message = `Waiting for the host to start the game. (${readyPlayers}/${playerCount} players ready).`;
        }
    }

    waitingMessage.innerHTML = `<p>${message}</p>`;
    waitingMessage.style.display = 'block';
}

/**
 * Updates ready status display and synchronizes with game state
 */
export function updateReadyStatus() {
    try {
        const readyCountElement = DOM.get('ready-count');
        const totalPlayersElement = DOM.get('total-players');

        if (!gameState.players || !Array.isArray(gameState.players)) {
            console.warn('[ui.js] No valid players array in game state');
            if (readyCountElement) readyCountElement.textContent = '0';
            if (totalPlayersElement) totalPlayersElement.textContent = '0';
            return;
        }

        // Calculate ready status from current player list
        const readyPlayers = gameState.players.filter(p => p && p.isReady === true).length;
        const totalPlayers = gameState.players.length;
        
        // Update gameState with calculated values
        gameState.readyCount = readyPlayers;
        
        // Find current player's ready status and update gameState
        const currentSocketId = window.gameSocket?.id;
        const currentPlayer = gameState.players.find(p => p && p.id === currentSocketId);
        if (currentPlayer) {
            gameState.isReady = currentPlayer.isReady || false;
        }

        // Update UI elements
        if (readyCountElement) {
            readyCountElement.textContent = readyPlayers.toString();
        }
        if (totalPlayersElement) {
            totalPlayersElement.textContent = totalPlayers.toString();
        }

        // Update the ready button text and state
        const readyBtn = DOM.get('ready-btn');
        if (readyBtn) {
            updateReadyButton(readyBtn);
        }

        // Update dependent UI elements
        updateButtonStates();

        console.log(`[ui.js] Ready status updated: ${readyPlayers}/${totalPlayers} ready, current player ready: ${gameState.isReady}`);
        
        // Debug log for troubleshooting
        console.log('[ui.js] Players ready status:', gameState.players.map(p => ({
            id: p.id.substring(0, 4),
            name: p.name,
            isReady: p.isReady
        })));
        
    } catch (error) {
        console.error('[ui.js] Error updating ready status:', error);
        // Fallback values
        const readyCountElement = DOM.get('ready-count');
        const totalPlayersElement = DOM.get('total-players');
        if (readyCountElement) readyCountElement.textContent = '0';
        if (totalPlayersElement) totalPlayersElement.textContent = '0';
    }
} 