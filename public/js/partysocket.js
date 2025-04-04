/**
 * PartySocket connector for Stadt Land Fluss
 * Handles connection to PartyKit server and provides event handling
 */
class GamePartySocket {
  constructor(host) {
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
    this.connectionTimeout = null;
    
    console.log(`GamePartySocket initialized with host: ${this.host}`);
  }
  
  // Test if the PartyKit server is accessible
  async testConnection() {
    try {
      // Try to fetch from the server with a HEAD request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`https://${this.host}`, {
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
          this.triggerEvent('error', { message: 'Connection timed out. Server may be unavailable.' });
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
    console.log('Connected to PartyKit host:', this.host);
    console.log('Connection URL:', event.target?.url || 'Unknown');
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
      
      // Debug logging for specific message types
      if (data.type === 'error') {
        console.warn('💥 WebSocket received ERROR message:', {
          message: data.message,
          timestamp: new Date().toISOString(),
          details: data.details || 'No additional details',
          rawData: event.data.substring(0, 200) // Show first 200 chars of raw data
        });
      }
      
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
          this.connectToRoom(
            this.playerData.roomId,
            this.playerData.playerName,
            this.playerData.timeLimit
          );
        }
      }, delay);
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Maximum reconnection attempts reached');
      this.triggerEvent('error', { 
        message: 'Could not reconnect to game server after multiple attempts'
      });
      this.triggerEvent('disconnect');
    } else {
      this.triggerEvent('disconnect');
    }
  }
  
  handleError(error) {
    console.error('Connection error:', error);
    this.connectionState = 'error';
    this.triggerEvent('error', { message: 'Connection error' });
    
    // Clear connection timeout if it exists
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }
  
  send(data) {
    if (!this.connected || !this.connection) {
      console.error('Cannot send message: Not connected');
      return false;
    }
    
    try {
      const message = JSON.stringify(data);
      console.log('🔍 WebSocket sending data:', message.substring(0, 500) + (message.length > 500 ? '...' : ''));
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
      host: this.host
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