/**
 * dom.js
 * DOM manipulation utilities.
 */

// Import shared state if needed (e.g., for context in showScreen)
// import { gameState } from './state.js';

// DOM querying utilities
export const DOM = {
  get: id => document.getElementById(id),
  query: (selector, parent = document) => parent.querySelector(selector),
  queryAll: (selector, parent = document) => parent.querySelectorAll(selector),
  create: (tag, attributes = {}, children = []) => {
    const element = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') element.className = value;
      else if (key === 'innerHTML') element.innerHTML = value;
      else element.setAttribute(key, value);
    });
    children.forEach(child => {
      element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return element;
  }
};

// Global screen references (initialize once)
export const screens = {
  welcome: DOM.get('welcome-screen'),
  lobby: DOM.get('lobby-screen'),
  game: DOM.get('game-screen'),
  results: DOM.get('results-screen')
};

// Function to show a specific screen and hide others
export function showScreen(screenId) {
  console.log(`[dom.js] Attempting to show screen: ${screenId}`);

  // Hide all screens first
  Object.values(screens).forEach(screen => {
    if (screen) {
      screen.classList.remove('active');
      screen.classList.add('hidden');
    } else {
      // This might happen if DOM hasn't fully loaded when screen refs are initialized
      // console.warn(`[dom.js] Screen element reference is null during hide phase.`);
    }
  });

  // Show the requested screen
  const screenToShow = screens[screenId];

  if (screenToShow) {
    console.log(`[dom.js] Showing screen element:`, screenToShow.id);
    screenToShow.classList.remove('hidden');

    // Trigger screen-specific setup logic after showing
    // We need to import these functions from other modules
    // Example: import { initializeLobbyUI } from './lobby.js';
    // We'll add imports later once functions are moved
    switch (screenId) {
      case 'welcome':
        // import { updateJoinButtonText } from './ui.js'; // Placeholder
        // if (typeof updateJoinButtonText === 'function') setTimeout(updateJoinButtonText, 50);
        // else console.warn('updateJoinButtonText not found');
        break;
      case 'lobby':
        // import { initializeLobbyUI } from './lobby.js'; // Placeholder
        // if (typeof initializeLobbyUI === 'function') setTimeout(initializeLobbyUI, 50);
        // else console.warn('initializeLobbyUI not found');
        break;
      // Add cases for 'game' and 'results' if they need specific init logic on show
    }

    // Small delay to allow the DOM to update before adding the active class for transitions
    setTimeout(() => {
      screenToShow.classList.add('active');
    }, 50);

  } else {
    console.error(`[dom.js] Screen not found for id: ${screenId}. Available screens:`, screens);
  }
}

// Error display function
export function showError(message) {
    console.error(`[UI Error] ${message}`);

    try {
        const errorModal = DOM.get('error-modal');
        const errorMessage = DOM.get('error-message');
        const closeBtn = DOM.get('error-close-btn');
        const okBtn = DOM.get('error-ok-btn');

        if (errorModal && errorMessage && closeBtn && okBtn) {
            errorMessage.textContent = message;
            errorModal.classList.remove('hidden');

            // Ensure listeners are attached only once or are idempotent
            const closeHandler = () => errorModal.classList.add('hidden');
            closeBtn.onclick = closeHandler; // Simple assignment works if called once
            okBtn.onclick = closeHandler;

            // Optional: Auto-hide after a delay
            // clearTimeout(window.errorTimeout); // Clear previous timeout if any
            // window.errorTimeout = setTimeout(closeHandler, 5000);

        } else {
            console.warn("Error modal elements not found, falling back to alert.");
            alert(message);
        }
    } catch (error) {
        console.error('Error displaying error message itself:', error);
        alert(message); // Ultimate fallback
    }
}

// Make utilities globally accessible (optional, imports are preferred)
// window.DOM = DOM;
// window.screens = screens;
// window.showScreen = showScreen;
// window.showError = showError; 