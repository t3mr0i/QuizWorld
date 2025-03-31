// PartySocket client for Stadt Land Fluss
class GamePartySocket {
  constructor() {
    this._handlers = {};
    this._connected = false;
    this._socket = null;
    this._id = null;
    this._roomId = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
  }

  get id() {
    return this._id;
  }

  get connected() {
    return this._connected;
  }

  get roomId() {
    return this._roomId;
  }

  // Simple method to connect to a specific room
  connectToRoom(roomId, playerName, timeLimit) {
    // Store data for reconnection
    this._playerName = playerName;
    this._timeLimit = timeLimit;
    
    // Always use the provided room ID or generate a random one
    this._roomId = roomId || Math.floor(Math.random() * 1000000).toString();
    
    // Close any existing connection
    if (this._socket) {
      try {
        this._socket.close();
      } catch (e) {
        console.warn('Error closing socket:', e);
      }
    }
    
    // Determine host based on environment
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const host = isLocalhost ? 'localhost:1999' : window.location.host;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Create WebSocket URL with room ID
    const url = `${protocol}//${host}/party/game/${this._roomId}`;
    console.log(`Connecting to room ${this._roomId} at ${url}`);
    
    // Create the WebSocket connection
    this._socket = new WebSocket(url);
    
    // Set up event handlers
    this._socket.onopen = () => {
      this._connected = true;
      this._reconnectAttempts = 0;
      console.log(`Connected to room ${this._roomId}`);
      
      // Auto-join the room when connection is established
      this.emit('joinRoom', {
        playerName: this._playerName,
        timeLimit: this._timeLimit
      });
      
      // Call connect handlers
      if (this._handlers['connect']) {
        this._handlers['connect'].forEach(handler => handler());
      }
    };
    
    this._socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);
        
        // Extract message type
        const type = data.type;
        
        // Handle init message
        if (type === 'init') {
          this._id = data.connectionId;
          console.log('Connection ID:', this._id);
        }
        
        // Call event handlers
        if (this._handlers[type]) {
          this._handlers[type].forEach(handler => handler(data));
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
    
    this._socket.onclose = (event) => {
      this._connected = false;
      console.log(`Connection closed with code ${event.code}`);
      
      // Attempt to reconnect
      if (this._reconnectAttempts < this._maxReconnectAttempts) {
        this._reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 10000);
        console.log(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})...`);
        
        setTimeout(() => {
          this.connectToRoom(this._roomId, this._playerName, this._timeLimit);
        }, delay);
      } else {
        console.error('Maximum reconnect attempts reached');
        
        if (this._handlers['disconnect']) {
          this._handlers['disconnect'].forEach(handler => handler());
        }
        
        // Show reconnect error
        if (typeof showConnectionError === 'function') {
          showConnectionError('Connection lost. Maximum reconnect attempts reached.');
        }
      }
    };
    
    this._socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      
      if (this._handlers['connect_error']) {
        this._handlers['connect_error'].forEach(handler => handler(error));
      }
    };
    
    return this._roomId;
  }

  // Socket.IO compatibility layer
  on(event, handler) {
    if (!this._handlers[event]) {
      this._handlers[event] = [];
    }
    
    this._handlers[event].push(handler);
    return this;
  }

  emit(event, data) {
    if (!this._connected) {
      console.warn('Attempting to send message while disconnected');
      return this;
    }
    
    const message = {
      type: event,
      ...data
    };
    
    this._socket.send(JSON.stringify(message));
    return this;
  }

  disconnect() {
    if (this._socket) {
      this._socket.close();
    }
  }
}

// Create a single global instance
window.gameSocket = new GamePartySocket();

// Backwards compatibility with Socket.IO style
function io() {
  return window.gameSocket;
} 