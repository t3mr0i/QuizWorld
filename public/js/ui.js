/**
 * ui.js
 * UI update functions and general UI logic.
 */

import { gameState, CATEGORIES } from './state.js';
import { DOM, screens } from './dom.js';

// This module assumes 'socket' is globally available via window.gameSocket
// or imported if socket.js is also refactored to export it.

export function updatePlayerList() {
    const playerList = DOM.get('player-list');
    if (!playerList) return;

    // Use the players array from the shared gameState
    const players = gameState.players || [];
    const adminId = gameState.adminId;
    const currentSocketId = window.gameSocket?.id;

    console.log('[ui.js] Updating player list. Players:', players.length, 'Admin:', adminId, 'Me:', currentSocketId);

    // Sort players: Admin first, then current player, then alphabetically
    const sortedPlayers = [...players].sort((a, b) => {
        if (a.id === adminId && b.id !== adminId) return -1;
        if (a.id !== adminId && b.id === adminId) return 1;
        if (a.id === currentSocketId && b.id !== currentSocketId) return -1;
        if (a.id !== currentSocketId && b.id === currentSocketId) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });

    // ******* ENHANCED PLAYER LIST RENDERING *******
    // Clear existing list
    playerList.innerHTML = '';
    
    // For debugging, add a "Players:" header directly to the list container
    playerList.setAttribute('data-count', `${sortedPlayers.length} players`);
    
    if (sortedPlayers.length === 0) {
        // Add a placeholder item if no players
        const emptyItem = document.createElement('li');
        emptyItem.className = 'player-item player-empty';
        emptyItem.innerHTML = '<strong style="color: #333;">No players connected</strong>';
        playerList.appendChild(emptyItem);
    } else {
        // Add each player with simpler, more explicit HTML
        sortedPlayers.forEach((player, index) => {
            if (!player || !player.id) return;
            
            // Create list item with inline styles to ensure visibility
            const li = document.createElement('li');
            li.className = 'player-item';
            if (player.id === currentSocketId) li.classList.add('current-player');
            if (player.id === adminId) li.classList.add('admin-player');
            if (player.isReady) li.classList.add('ready');
            
            // Use direct HTML with inline styles for maximum visibility
            let playerHTML = `
                <div style="display:flex; width:100%; align-items:center; padding:8px; background:${player.isReady ? '#e6ffe6' : '#fff'}; border-radius:4px;">
                    <span class="player-name" style="font-weight:bold; color:#000; font-size:16px; flex-grow:1; margin-right:10px;">
                        ${player.name || `Player (${player.id.substring(0,4)})`}
                    </span>
                    <div class="player-badges" style="display:flex; gap:4px;">`;
            
            // Add badges with inline styles
            if (player.id === currentSocketId) {
                playerHTML += `<span class="badge badge-you" style="background:#6c757d; color:white; padding:2px 5px; border-radius:3px; font-size:12px;">You</span>`;
            }
            if (player.id === adminId) {
                playerHTML += `<span class="badge badge-admin" style="background:#007bff; color:white; padding:2px 5px; border-radius:3px; font-size:12px;">Host</span>`;
            }
            if (player.isReady) {
                playerHTML += `<span class="badge badge-ready" style="background:#28a745; color:white; padding:2px 5px; border-radius:3px; font-size:12px;">Ready</span>`;
            }
            if (gameState.currentLetter && player.submitted) {
                playerHTML += `<span class="badge badge-submitted" style="background:#ffc107; color:black; padding:2px 5px; border-radius:3px; font-size:12px;">Submitted</span>`;
            }
            
            playerHTML += `
                    </div>
                </div>
            `;
            
            li.innerHTML = playerHTML;
            playerList.appendChild(li);
            
            console.log(`[ui.js] Added player ${player.name} to list with explicit HTML`);
        });
    }
    // ******* END ENHANCED PLAYER LIST RENDERING *******

    // Update waiting message visibility
    const waitingMessage = DOM.get('waiting-message');
    if (waitingMessage) {
        waitingMessage.style.display = players.length <= 1 ? 'block' : 'none';
    }

    // Update ready count display
    const readyCountEl = DOM.get('ready-count');
    const totalPlayersEl = DOM.get('total-players');
    if(readyCountEl) readyCountEl.textContent = players.filter(p => p.isReady).length || 0;
    if(totalPlayersEl) totalPlayersEl.textContent = players.length;

    // Update start button states
    updateButtonStates();
    
    console.log(`[ui.js] Player list updated with ${sortedPlayers.length} players using enhanced rendering`);
}

export function updateScores() {
    const scoresList = DOM.get('scores-list');
    if (!scoresList) return;

    const players = gameState.players || [];
    const currentSocketId = window.gameSocket?.id;

    scoresList.innerHTML = ''; // Clear previous scores

    // Sort players by score (descending)
    const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

    sortedPlayers.forEach((player, index) => {
        const li = DOM.create('li', { className: 'player-item' });
        if (player.id === currentSocketId) li.classList.add('current-player');

        const rankDiv = DOM.create('div', { className: `rank-badge rank-${index + 1}`, textContent: index + 1 });
        const nameDiv = DOM.create('div', { className: 'player-name', textContent: player.name || `Player ${player.id.substring(0,4)}` });
        const scoreDiv = DOM.create('div', { className: 'player-score', textContent: `${player.score || 0} pts` });

        if (player.id === currentSocketId) {
            nameDiv.appendChild(DOM.create('span', { className: 'you-label', textContent: ' (You)' }));
        }

        li.appendChild(rankDiv);
        li.appendChild(nameDiv);
        li.appendChild(scoreDiv);
        scoresList.appendChild(li);
    });
}

// Updates the text of the main join/create button based on room ID input
export function updateJoinButtonText() {
    const joinGameBtn = DOM.get('join-game-btn');
    const roomIdInput = DOM.get('room-id');
    if (!joinGameBtn || !roomIdInput) return;

    const hasRoomId = roomIdInput.value.trim() !== '';
    joinGameBtn.textContent = hasRoomId ? 'Join Game' : 'Create Game';
}

// Updates the state of lobby buttons (Start, Ready) based on game state
export function updateButtonStates() {
    const startGameBtn = DOM.get('start-game-btn');
    const readyBtn = DOM.get('ready-btn');
    const universalStartBtn = DOM.get('universal-start-btn'); // Client-side start button

    if (!startGameBtn || !readyBtn || !universalStartBtn) {
        console.warn("[ui.js] Lobby buttons not found, cannot update states.");
        return;
    }

    const players = gameState.players || [];
    const totalPlayers = players.length;
    const readyPlayers = gameState.readyCount;

    // Calculate required ready players (e.g., half rounded up, minimum 2 if > 1 player)
    const requiredReady = totalPlayers <= 1 ? totalPlayers : (totalPlayers === 2 ? 2 : Math.ceil(totalPlayers / 2));
    const canStart = readyPlayers >= requiredReady;

    // --- Admin Start Button (Host Only) ---
    startGameBtn.disabled = !canStart;
    const adminMsg = DOM.get('admin-message');
    if (adminMsg) {
        adminMsg.textContent = canStart ? "" : `Waiting for ${requiredReady - readyPlayers} more player(s) to be ready...`;
    }

    // --- Universal Start Button (Client-Side Mode) ---
    const useUniversalStart = window.CONFIG?.ALLOW_ANYONE_TO_START || gameState.clientSideMode;
    universalStartBtn.style.display = useUniversalStart ? 'block' : 'none';
    universalStartBtn.disabled = !canStart;
    const universalHint = DOM.query('.footer-hint', universalStartBtn.parentElement);
    if(universalHint) universalHint.style.display = useUniversalStart ? 'block' : 'none';


    // --- Ready Button --- 
    // Log the state right before updating the button
    console.log(`[ui.js->updateButtonStates] Updating readyBtn. gameState.isReady: ${gameState.isReady}`);
    console.log(`[ui.js->updateButtonStates] Updating readyBtn. Button current text: "${readyBtn.textContent}"`);
    readyBtn.textContent = gameState.isReady ? "I'm NOT Ready" : "I'm Ready";
    console.log(`[ui.js->updateButtonStates] Updating readyBtn. Button new text: "${readyBtn.textContent}"`);
    readyBtn.classList.toggle('btn-outline-success', !gameState.isReady);
    readyBtn.classList.toggle('btn-outline-warning', gameState.isReady);
}

// Updates admin-specific controls (like category management) visibility
export function updateAdminControls() {
    const adminControls = DOM.get('admin-controls'); // Host start button container
    const categoryManagement = DOM.query('.category-management'); // Category edit section

    const isAdmin = gameState.isAdmin;
    console.log(`[ui.js] Updating admin controls visibility. IsAdmin: ${isAdmin}`);

    if (adminControls) {
        adminControls.style.display = isAdmin ? 'block' : 'none';
    }
    if (categoryManagement) {
        // Allow category editing only for admin
        const inputs = DOM.queryAll('input, button', categoryManagement);
        inputs.forEach(input => input.disabled = !isAdmin);
        categoryManagement.classList.toggle('admin-only', !isAdmin); // Add class to potentially style non-admin view
        
        // Also, ensure category list itself is visible but maybe styled differently
        categoryManagement.style.opacity = isAdmin ? '1' : '0.7'; // Example: dim for non-admins
    }

    // Update waiting message as admin status affects instructions
    updateWaitingMessage();
}

// Display round results (modified from original to fit UI structure)
export function displayRoundResults(data) {
  // data format: { scores: { category: { playerId: { answer, score, explanation } } }, players: [...], categories: [...] }
  console.log("[ui.js] Displaying round results...", data);

  const resultsTableBody = DOM.get('results-body');
  const resultsTitle = DOM.get('results-title'); // Optional title element
  const resultLetter = DOM.get('result-letter'); // Element to show the round letter

  if (!resultsTableBody) {
    console.error("Results table body not found!");
    return;
  }

  resultsTableBody.innerHTML = ''; // Clear previous results

  if (resultsTitle) resultsTitle.textContent = 'Round Results'; // Reset title
  if (resultLetter && gameState.currentLetter) resultLetter.textContent = gameState.currentLetter;

  if (!data || !data.scores || !data.players || !data.categories) {
    resultsTableBody.innerHTML = '<tr><td colspan="4">Error: Incomplete results data received.</td></tr>';
    return;
  }

  const scoresByCategory = data.scores; // { category -> { playerId -> { answer, score, explanation } } }
  const players = data.players; // Updated player list with total scores
  const categories = data.categories;
  const currentSocketId = window.gameSocket?.id;

  // Create rows grouped by category
  categories.forEach((category, catIndex) => {
    // Category header row
    const headerRow = DOM.create('tr', { className: 'category-header-row' }, [
      DOM.create('td', { colSpan: 4, innerHTML: `<h3>${category}</h3>` })
    ]);
    resultsTableBody.appendChild(headerRow);

    // Rows for each player for this category
    players.forEach((player, playerIndex) => {
      const categoryScores = scoresByCategory[category] || {};
      const scoreData = categoryScores[player.id]; // { answer, score, explanation } or undefined

      const answer = scoreData?.answer || '-';
      const score = scoreData?.score ?? 0;
      const explanation = scoreData?.explanation || (answer === '-' ? 'No answer' : '-');

      const row = DOM.create('tr', {});
      row.style.animationDelay = `${(catIndex * players.length + playerIndex) * 0.05}s`; // Stagger animation
      if (player.id === currentSocketId) row.classList.add('current-player-row');

      // Player Name Cell
      const nameCell = DOM.create('td', {}, [player.name || `Player ${player.id.substring(0,4)}`]);
      if (player.id === currentSocketId) nameCell.innerHTML += ' <span class="you-label">(You)</span>';

      // Answer Cell
      const answerCell = DOM.create('td', { className: `answer-cell score-${score > 0 ? 'valid' : 'invalid'}` }, [answer]);

      // Score Cell
      const scoreCell = DOM.create('td', { className: `score-cell ${score > 0 ? 'valid-points' : 'invalid-points'}` }, [score.toString()]);

      // Explanation Cell
      const explanationCell = DOM.create('td', { className: 'explanation-cell' }, [explanation]);

      row.appendChild(nameCell);
      row.appendChild(answerCell);
      row.appendChild(scoreCell);
      row.appendChild(explanationCell);
      resultsTableBody.appendChild(row);
    });
  });

  // Update the separate scores list/leaderboard
  updateScores();
}

function updateWaitingMessage() {
  const waitingMessage = DOM.get('waiting-message');
   const adminControls = DOM.get('category-management'); // Check if admin controls are visible

  if (!waitingMessage) return;

  const playerCount = gameState.players ? gameState.players.length : 0;
  const isAdmin = gameState.isAdmin;
  const lobbyScreenActive = screens.lobby && screens.lobby.classList.contains('active');

  if (!lobbyScreenActive) {
    waitingMessage.style.display = 'none';
    return;
  }

  let message = '';
  if (playerCount <= 1) {
      message = isAdmin ? 'You can start playing alone whenever you\'re ready. Use the Start Game button.' : 'Waiting for the host to start the game.';
  } else {
      const readyPlayers = gameState.readyCount || 0;
      const totalPlayers = playerCount;
      const requiredReady = totalPlayers <= 2 ? totalPlayers : Math.ceil(totalPlayers / 2);

      if (isAdmin) {
          if (readyPlayers >= requiredReady) {
              message = `Enough players are ready (${readyPlayers}/${totalPlayers})! Click START GAME below.`;
          } else {
              message = `Waiting for more players to be ready (${readyPlayers}/${totalPlayers} ready, need ${requiredReady}).`;
          }
      } else {
           message = `Waiting for the host to start the game. (${readyPlayers}/${totalPlayers} players ready).`;
      }
  }

  waitingMessage.innerHTML = `<p>${message}</p>`;
  waitingMessage.style.display = 'block';

  // Also update admin controls visibility as it's related
  if (adminControls) {
       adminControls.style.display = isAdmin ? 'block' : 'none';
  }
}


export function updateReadyStatus() {
  try {
    // Log when this function is called and the state it sees initially
    console.log(`[ui.js->updateReadyStatus] Called. Initial gameState.isReady: ${gameState.isReady}, Players: ${gameState.players?.length}`);

    const readyCountElement = DOM.get('ready-count');
    const totalPlayersElement = DOM.get('total-players');
    const readyBtn = DOM.get('ready-btn'); // The button the player clicks

    if (!gameState.players) {
      console.warn('No players array in game state for ready status update');
      if(readyCountElement) readyCountElement.textContent = '0';
      if(totalPlayersElement) totalPlayersElement.textContent = '0';
      return;
    }

    // Recalculate ready count from the current player list
    const readyPlayers = gameState.players.filter(player => player && player.isReady).length;
    const totalPlayers = gameState.players.length;
    gameState.readyCount = readyPlayers; // Update state

    // Find the current player's status
    const currentPlayer = gameState.players.find(p => p && p.id === (window.gameSocket?.id || ''));
    const isCurrentlyReady = currentPlayer ? currentPlayer.isReady : false;
    gameState.isReady = isCurrentlyReady; // Update state


    // Update UI display for counts
    // Log the calculated values before updating UI
    console.log(`[ui.js->updateReadyStatus] Calculated ready: ${readyPlayers}, total: ${totalPlayers}, currentPlayer isReady: ${isCurrentlyReady}`);
    if (readyCountElement) {
      readyCountElement.textContent = readyPlayers.toString();
    } else {
      console.warn("Element with ID 'ready-count' not found.");
    }

    if (totalPlayersElement) {
      totalPlayersElement.textContent = totalPlayers.toString();
    } else {
       console.warn("Element with ID 'total-players' not found.");
    }

    // Update other elements that depend on readiness (like Start buttons)
    updateButtonStates(); // This function handles the readyBtn state correctly

    console.log(`UI Ready status updated: ${readyPlayers}/${totalPlayers} players ready. Current player ready: ${isCurrentlyReady}`);
  } catch (error) {
    console.error('Error updating ready status UI:', error);
  }
}


// Helper to update the Ready/Cancel button style and text
function updateReadyButtonState(button, isReady) {
   if (!button) return;
   const readyState = typeof isReady === 'boolean' ? isReady : gameState.isReady; // Use provided state or fallback

   if (readyState) {
    button.textContent = 'Cancel Ready';
    button.classList.add('btn-outline-danger');
    button.classList.remove('btn-outline-success');
  } else {
    button.textContent = 'I\'m Ready';
    button.classList.add('btn-outline-success');
    button.classList.remove('btn-outline-danger');
  }
} 