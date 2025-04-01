/**
 * PartySocket connector for Stadt Land Fluss
 * Handles connection to PartyKit server and provides event handling
 */
class GamePartySocket {
  constructor(host) {
    // Check for PARTYKIT_HOST in window object (set in index.html)
    this.host = host || window.PARTYKIT_HOST || window.location.host;
    
    // Log host info for debugging
    console.log('PartySocket host configuration:');
    console.log('- window.PARTYKIT_HOST:', window.PARTYKIT_HOST);
    console.log('- window.location.host:', window.location.host);
    console.log('- Using host:', this.host);
    
    this.connection = null;
    this.id = null;
    this.connected = false;
    this.reconnecting = false;
    this.maxReconnectAttempts = 5;
    this.reconnectAttempts = 0;
    this.playerData = null;
    this.eventHandlers = {};
    this.ws = null;
    this.connectionState = 'disconnected';
    this.events = {};
    
    console.log(`GamePartySocket initialized with host: ${this.host}`);
  }
  
  connectToRoom(roomId, playerName, timeLimit) {
    console.log(`Connecting to room: ${roomId}, player: ${playerName}`);
    
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
      // Create new PartySocket connection using the correct URL format
      // Determine protocol based on current page
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      
      // Use the configured host instead of always using window.location.host
      const host = this.host;
      
      // Create URL with the party ID (room ID)
      // We need to use 'game' as the party name and pass the room ID as a parameter
      const url = `${protocol}//${host}/party/game?roomId=${this.playerData.roomId}`;
      console.log(`Connecting to: ${url}`);
      
      this.connection = new WebSocket(url);
      
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
    
    // Attempt to reconnect if needed
    if (this.playerData && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.reconnecting = true;
      
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        if (this.playerData) {
          this.connectToRoom(
            this.playerData.roomId,
            this.playerData.playerName,
            this.playerData.timeLimit
          );
        }
      }, 1000 * Math.min(this.reconnectAttempts, 5));
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Maximum reconnection attempts reached');
      this.triggerEvent('error', { 
        message: 'Could not reconnect to game server after multiple attempts' 
      });
    }
    
    // Trigger disconnect event
    this.triggerEvent('disconnect');
  }
  
  handleError(error) {
    console.error('Connection error:', error);
    this.triggerEvent('error', { message: 'Connection error' });
  }
  
  send(data) {
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
      playerData: this.playerData
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