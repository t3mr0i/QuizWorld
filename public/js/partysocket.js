/**
 * PartySocket connector for Stadt Land Fluss
 * Handles connection to PartyKit server and provides event handling
 */
class GamePartySocket {
  constructor(host) {
    // Check for URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const useOfflineMode = urlParams.has('offline');
    const useLocalServer = urlParams.has('local') || urlParams.has('dev');
    
    // Set host based on parameters
    if (useOfflineMode) {
      // Offline mode - no server connections will be attempted
      this.host = null;
      this.offlineMode = true;
      console.log('Running in offline mode - no server connections will be attempted');
    } else if (useLocalServer) {
      // Local server mode
      this.host = 'localhost:1999';
      this.offlineMode = false;
      console.log('Using local development server:', this.host);
    } else {
      // Ensure host is not using a placeholder value
      if (host === '__PARTYKIT_HOST__' || !host) {
        // Fallback to hardcoded value if the placeholder wasn't replaced
        this.host = 'stadt-land-fluss.t3mr0i.partykit.dev';
      } else {
        this.host = host || window.PARTYKIT_HOST || window.location.host;
      }
      
      // Make sure we don't have a placeholder in PARTYKIT_HOST
      if (window.PARTYKIT_HOST === '__PARTYKIT_HOST__') {
        window.PARTYKIT_HOST = 'stadt-land-fluss.t3mr0i.partykit.dev';
      }
      
      this.offlineMode = false;
    }
    
    // Log host info for debugging
    console.log('PartySocket host configuration:');
    console.log('- window.PARTYKIT_HOST:', window.PARTYKIT_HOST);
    console.log('- window.location.host:', window.location.host);
    console.log('- Using host:', this.host);
    console.log('- Offline mode:', this.offlineMode);
    
    this.connection = null;
    this.id = null;
    this.connected = false;
    this.reconnecting = false;
    this.maxReconnectAttempts = 5;
    this.reconnectAttempts = 0;
    this.playerData = null;
    this.eventHandlers = {};
    this.ws = null;
    this.connectionState = this.offlineMode ? 'offline' : 'disconnected';
    this.events = {};
    this.connectionTimeout = null;
    this.offlineRoomId = Math.floor(Math.random() * 1000000).toString();
    
    console.log(`GamePartySocket initialized with host: ${this.host || 'OFFLINE MODE'}`);
    
    // If in offline mode, trigger a fake connection event after a short delay
    if (this.offlineMode) {
      setTimeout(() => {
        this.triggerEvent('connect');
      }, 500);
    }
  }
  
  // Test if the PartyKit server is accessible
  async testConnection() {
    // If in offline mode, return false immediately
    if (this.offlineMode || !this.host) {
      return false;
    }
    
    try {
      // Try to fetch from the server with a HEAD request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const protocol = this.host.includes('localhost') ? 'http://' : 'https://';
      const response = await fetch(`${protocol}${this.host}`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch (error) {
      console.error('Server connection test failed:', error);
      return false;
    }
  }
  
  connectToRoom(roomId, playerName, timeLimit) {
    console.log(`Connecting to room: ${roomId}, player: ${playerName}`);
    
    // In offline mode, simulate a connection
    if (this.offlineMode) {
      // Generate a fake room ID if none was provided
      const offlineRoomId = roomId || this.offlineRoomId;
      
      // Store player data
      this.playerData = {
        roomId: offlineRoomId,
        playerName,
        timeLimit: timeLimit || 60
      };
      
      this.id = 'offline-' + Math.random().toString(36).substring(2, 9);
      
      // Simulate a join response
      setTimeout(() => {
        this.triggerEvent('message', {
          type: 'joined',
          roomId: offlineRoomId,
          players: [{ id: this.id, name: playerName, score: 0, isAdmin: true }],
          adminId: this.id,
          isAdmin: true,
          playerId: this.id
        });
        
        // Then simulate a joinedRoom message
        setTimeout(() => {
          this.triggerEvent('message', {
            type: 'joinedRoom',
            roomId: offlineRoomId,
            players: [{ id: this.id, name: playerName, score: 0 }],
            adminId: this.id,
            isAdmin: true,
            playerId: this.id
          });
        }, 200);
      }, 500);
      
      return;
    }
    
    // Store player data for reconnection
    this.playerData = {
      roomId: roomId || Math.floor(Math.random() * 1000000).toString(),
      playerName,
      timeLimit
    };
    
    // If already connected, disconnect first
    if (this.connection) {
      try {
        console.log('Closing existing connection before connecting to new room');
        this.connection.close();
      } catch (err) {
        console.error('Error closing existing connection:', err);
      }
    }
    
    try {
      // Ensure we don't have a placeholder value
      if (this.host.includes('__PARTYKIT_HOST__')) {
        this.host = 'stadt-land-fluss.t3mr0i.partykit.dev';
        console.warn('Placeholder detected, using fallback host:', this.host);
      }
      
      // Determine protocol based on the host
      // When connecting to external PartyKit server, always use wss:// protocol
      // When on localhost, use the current page protocol
      let protocol;
      if (this.host.includes('localhost') || this.host.includes('127.0.0.1')) {
        protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      } else {
        // Always use secure WebSocket for external hosts
        protocol = 'wss:';
      }
      
      console.log(`Using protocol ${protocol} for host ${this.host}`);
      
      // Create URL with the party ID (room ID)
      const url = `${protocol}//${this.host}/party/game?roomId=${this.playerData.roomId}`;
      console.log(`Connecting to: ${url}`);
      
      this.connection = new WebSocket(url);
      
      // Set connection timeout
      this.connectionTimeout = setTimeout(() => {
        if (!this.connected) {
          console.error('Connection timed out');
          if (this.connection) {
            this.connection.close();
          }
          this.triggerEvent('error', { 
            message: 'Connection timed out. Server may be unavailable.',
            isServerDown: true
          });
        }
      }, 10000);
      
      // Set up event handlers
      this.connection.onopen = this.handleOpen.bind(this);
      this.connection.onmessage = this.handleMessage.bind(this);
      this.connection.onclose = this.handleClose.bind(this);
      this.connection.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('Error creating connection:', error);
      this.triggerEvent('error', { message: 'Failed to connect to game server' });
    }
  }
  
  handleOpen(event) {
    console.log('Connection established to game server');
    this.connected = true;
    this.reconnectAttempts = 0;
    this.connectionState = 'connected';
    
    // Clear connection timeout
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    // Set connection ID if available
    if (event.target && event.target.url) {
      const urlParts = event.target.url.split('/');
      this.id = urlParts[urlParts.length - 1] || null;
    }
    
    // Send join message with player data
    if (this.playerData) {
      this.send({
        type: 'joinRoom',
        playerName: this.playerData.playerName,
        timeLimit: this.playerData.timeLimit,
        roomId: this.playerData.roomId // Include room ID in the join message
      });
    }
    
    // Trigger connect event
    this.triggerEvent('connect');
  }
  
  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      console.log('Received message:', data);
      
      // If this is a connection ID message, store it
      if (data.type === 'connection' && data.id) {
        this.id = data.id;
        console.log(`Connection ID set: ${this.id}`);
      }
      
      // Trigger message event with data
      this.triggerEvent('message', data);
    } catch (error) {
      console.error('Error parsing message:', error, event.data);
    }
  }
  
  handleClose(event) {
    console.log(`Connection closed: ${event.code} ${event.reason}`);
    this.connected = false;
    this.connectionState = 'disconnected';
    
    // Clear connection timeout if it exists
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    // Don't attempt to reconnect for normal closure
    if (event.code === 1000) {
      console.log('Normal closure, not attempting to reconnect');
      this.triggerEvent('disconnect');
      return;
    }
    
    // Attempt to reconnect if needed
    if (this.playerData && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.reconnecting = true;
      this.connectionState = 'reconnecting';
      
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      // Exponential backoff for reconnection attempts
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 10000);
      
      setTimeout(() => {
        if (this.playerData) {
          // Test the connection before trying to reconnect
          this.testConnection().then(isConnectable => {
            if (isConnectable) {
              this.connectToRoom(
                this.playerData.roomId,
                this.playerData.playerName,
                this.playerData.timeLimit
              );
            } else {
              console.error('Server appears to be down, not attempting further connection');
              this.triggerEvent('error', { 
                message: 'Game server appears to be offline. Please try again later.',
                isServerDown: true
              });
              this.triggerEvent('disconnect');
            }
          });
        }
      }, delay);
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Maximum reconnection attempts reached');
      this.triggerEvent('error', { 
        message: 'Could not reconnect to game server after multiple attempts',
        isServerDown: true
      });
      this.triggerEvent('disconnect');
    } else {
      this.triggerEvent('disconnect');
    }
  }
  
  handleError(error) {
    console.error('Connection error:', error);
    this.connectionState = 'error';
    this.triggerEvent('error', { 
      message: 'Connection error',
      isServerDown: true
    });
    
    // Clear connection timeout if it exists
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }
  
  send(data) {
    // In offline mode, handle messages locally
    if (this.offlineMode) {
      console.log('Offline mode - handling message locally:', data);
      
      // Handle specific message types
      switch (data.type) {
        case 'startRound':
          // Generate a random letter for the round
          const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
          const randomLetter = letters.charAt(Math.floor(Math.random() * letters.length));
          
          // Simulate a roundStarted message
          setTimeout(() => {
            this.triggerEvent('message', {
              type: 'roundStarted',
              letter: randomLetter,
              timeLimit: this.playerData.timeLimit || 60
            });
          }, 500);
          break;
          
        case 'submitAnswers':
          // Simulate a player submitted message
          setTimeout(() => {
            // Mark current player as submitted
            const players = [{ 
              id: this.id, 
              name: this.playerData.playerName, 
              submitted: true,
              score: Math.floor(Math.random() * 50) // Random score for testing
            }];
            
            this.triggerEvent('message', {
              type: 'playerSubmitted',
              players: players
            });
            
            // Then simulate round results
            setTimeout(() => {
              const answers = data.answers || {};
              const scores = {
                [this.id]: { total: 0 }
              };
              
              // Generate mock scores for each category
              Object.keys(answers).forEach(category => {
                const answer = answers[category];
                const points = answer ? Math.floor(Math.random() * 10) : 0;
                
                scores[this.id][category] = {
                  answer: answer || '-',
                  points: points,
                  explanation: points > 0 ? 
                    'Valid answer.' : 
                    'Invalid answer. Suggestions: Example, Test'
                };
                
                scores[this.id].total += points;
              });
              
              this.triggerEvent('message', {
                type: 'roundResults',
                players: [{ 
                  id: this.id, 
                  name: this.playerData.playerName,
                  score: scores[this.id].total
                }],
                scores: scores
              });
            }, 1000);
          }, 500);
          break;
      }
      
      return true;
    }
    
    // Online mode - send to server
    if (!this.connected || !this.connection) {
      console.error('Cannot send message: Not connected');
      return false;
    }
    
    try {
      const message = JSON.stringify(data);
      this.connection.send(message);
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }
  
  on(eventName, callback) {
    if (!this.eventHandlers[eventName]) {
      this.eventHandlers[eventName] = [];
    }
    
    this.eventHandlers[eventName].push(callback);
  }
  
  off(eventName, callback) {
    if (!this.eventHandlers[eventName]) return;
    
    if (callback) {
      this.eventHandlers[eventName] = this.eventHandlers[eventName].filter(
        cb => cb !== callback
      );
    } else {
      delete this.eventHandlers[eventName];
    }
  }
  
  triggerEvent(eventName, data) {
    if (!this.eventHandlers[eventName]) return;
    
    this.eventHandlers[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${eventName} event handler:`, error);
      }
    });
  }
  
  // Get current connection state
  getState() {
    return {
      connectionState: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      playerData: this.playerData,
      host: this.host,
      offlineMode: this.offlineMode
    };
  }
  
  // Add alias for startConnection for compatibility
  startConnection(data) {
    if (typeof data === 'object') {
      // If called with an object, extract the needed properties
      this.connectToRoom(
        data.roomId,
        data.name,
        data.timeLimit
      );
    } else {
      console.error('startConnection called with invalid parameters');
    }
  }
}

// Create a single instance for the application
window.gameSocket = new GamePartySocket();

// Factory function for compatibility
function io() {
  return window.gameSocket;
} 