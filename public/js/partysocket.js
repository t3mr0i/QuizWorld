// PartySocket client for Stadt Land Fluss
class GamePartySocket {
  constructor() {
    this._handlers = {};
    this._connected = false;
    this._socket = null;
    this._id = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
  }

  get id() {
    return this._id;
  }

  get connected() {
    return this._connected;
  }

  connect() {
    // Determine host based on environment
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const host = isLocalhost ? 'localhost:1999' : window.location.host;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    const url = `${protocol}//${host}/party/game`;
    
    console.log(`Connecting to PartyKit at ${url}`);
    
    this._socket = new WebSocket(url);
    
    this._socket.onopen = () => {
      this._connected = true;
      this._reconnectAttempts = 0;
      console.log('Connected to PartyKit');
      
      if (this._handlers['connect']) {
        this._handlers['connect'].forEach(handler => handler());
      }
    };
    
    this._socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);
        
        // Extract the message type and handle it
        const type = data.type;
        
        if (type === 'init') {
          // Store the connection ID if available
          if (data.connectionId) {
            this._id = data.connectionId;
          }
        }
        
        // Call the appropriate event handlers
        if (this._handlers[type]) {
          this._handlers[type].forEach(handler => handler(data));
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
    
    this._socket.onclose = (event) => {
      this._connected = false;
      console.log(`WebSocket closed with code ${event.code}`);
      
      // Attempt to reconnect
      if (this._reconnectAttempts < this._maxReconnectAttempts) {
        this._reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000);
        console.log(`Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})...`);
        
        setTimeout(() => this.connect(), delay);
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

// Create a singleton instance that mimics Socket.IO's global io() function
function io() {
  if (!window._gamePartySocket) {
    window._gamePartySocket = new GamePartySocket();
    window._gamePartySocket.connect();
  }
  
  return window._gamePartySocket;
} 