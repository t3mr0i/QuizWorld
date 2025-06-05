/**
 * PartySocket connector for Stadt Land Fluss
 * Handles connection to PartyKit server and provides event handling
 */
class GamePartySocket {
  constructor(host) {
    // For development, always use localhost with the current port
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      this.host = window.location.host; // This will be localhost:50444 or whatever port
      console.log('Development mode detected, using localhost:', this.host);
    } else if (host === '__PARTYKIT_HOST__' || !host) {
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
      console.log(`[PartySocket] Connecting to URL: ${url}`); // Modified log

      // Log before creating WebSocket
      console.log(`[PartySocket] Attempting to create new WebSocket connection...`);

      this.connection = new WebSocket(url);

      // Log after creating WebSocket object (doesn't mean connected yet)
      console.log(`[PartySocket] WebSocket object created. ReadyState: ${this.connection?.readyState}`);

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
    console.log('[PartySocket] --- handleOpen --- Connection established!'); // <-- ADD LOG
    console.log('[PartySocket] handleOpen: Connected to PartyKit host:', this.host);
    console.log('[PartySocket] handleOpen: Connection URL:', event.target?.url || 'Unknown');
    console.log(`[PartySocket] handleOpen: WebSocket ReadyState: ${this.connection?.readyState}`); // <-- ADD LOG
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
    console.log(`[PartySocket] --- handleMessage --- Received data:`, event.data); // <-- ADD LOG
    try {
      const data = JSON.parse(event.data);
      console.log('[PartySocket] handleMessage: Parsed message:', data); // Modified log

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
    console.log(`[PartySocket] --- handleClose --- Connection closed. Code: ${event.code}, Reason: ${event.reason}, WasClean: ${event.wasClean}`); // <-- ADD LOG
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

  handleError(errorEvent) {
    // Log the raw event if possible
    console.error('[PartySocket] --- handleError --- Connection error event:', errorEvent); // <-- ADD LOG
    // Try to get more specific error details if it's an Event object
    let errorMessage = 'Unknown connection error';
    if (errorEvent instanceof Event) {
        errorMessage = `WebSocket error event (type: ${errorEvent.type})`;
    } else if (errorEvent instanceof Error) {
        errorMessage = errorEvent.message;
    } else if (typeof errorEvent === 'string') {
        errorMessage = errorEvent;
    }
    console.error('[PartySocket] handleError: Processed error message:', errorMessage);

    this.connectionState = 'error';
    this.triggerEvent('error', { message: errorMessage });
    
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
    console.log(`[PartySocket.on] Registering handler for event: '${eventName}'. Callback:`, callback?.name || typeof callback);

    if (!this.eventHandlers[eventName]) {
      this.eventHandlers[eventName] = [];
    }
    this.eventHandlers[eventName].push(callback);

    console.log(`[PartySocket.on] Current handlers for '${eventName}':`, this.eventHandlers[eventName].length);
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
    console.log(`[PartySocket.triggerEvent] Attempting to trigger event: '${eventName}'. Data:`, data);

    if (!this.eventHandlers[eventName]) {
      console.log(`[PartySocket.triggerEvent] No handlers found for '${eventName}'. Existing handlers:`, Object.keys(this.eventHandlers));
      return;
    }

    const handlers = this.eventHandlers[eventName];
    console.log(`[PartySocket.triggerEvent] Found ${handlers.length} handler(s) for '${eventName}'.`);

    handlers.forEach((callback, index) => {
      try {
        console.log(`[PartySocket.triggerEvent] Executing handler #${index + 1} for '${eventName}'...`);
        callback(data);
        console.log(`[PartySocket.triggerEvent] Handler #${index + 1} for '${eventName}' executed successfully.`);
      } catch (error) {
        console.error(`[PartySocket.triggerEvent] Error in ${eventName} event handler #${index + 1}:`, error);
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
