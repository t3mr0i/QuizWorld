import type * as Party from "partykit/server";

// Game constants
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Simplified Player interface - no complex session tracking
interface Player {
  id: string;
  name: string;
  answers: Record<string, string>;
  score: number;
  isAdmin: boolean;
  submitted: boolean;
  isReady: boolean;
}

// Simplified RoomState interface
interface RoomState {
  players: Record<string, Player>;
  currentLetter: string | null;
  roundInProgress: boolean;
  roundResults: Record<string, any>;
  admin: string;
  timeLimit: number;
  timerEnd: Date | null;
  categories: string[];
  readyCount: number;
}

// Store for game states by room ID
const roomStates: Record<string, RoomState> = {};

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// Default categories
const DEFAULT_CATEGORIES = ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Pflanze', 'Tier'];

// Define a type for our validator module
interface ValidatorModule {
  validateAnswers: (letter: string, answers: any, categories: string[]) => Promise<any>;
}

let validatorModule: ValidatorModule | null = null;
let validatorLoadAttempted = false;

// AI Validator for PartyKit environment using fetch API
console.log("🚀 SERVER STARTING: AI Validator enabled using fetch API");

// AI Validation function using OpenAI Assistant API
async function validateAnswersWithOpenAI(letter: string, answers: Record<string, Record<string, string>>, categories: string[]): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  const assistantId = 'asst_3Lqlm7XjAeciaGU8VbVOS8Al';
  
  if (!apiKey) {
    throw new Error("OpenAI API key not found");
  }

  // Prepare the validation message
  const message = `Letter: ${letter}

Categories and answers to validate:
${Object.entries(answers).map(([playerId, playerAnswers]) => 
  `Player ${playerId}:\n${categories.map(cat => `  ${cat}: ${playerAnswers[cat] || '(no answer)'}`).join('\n')}`
).join('\n\n')}`;

  try {
    console.log("🤖 Creating thread for OpenAI Assistant...");
    console.log("🔑 API Key exists:", !!apiKey);
    console.log("🔑 API Key prefix:", apiKey ? apiKey.substring(0, 10) + '...' : 'undefined');
    console.log("🤖 Assistant ID:", assistantId);
    
    // Step 0: Verify assistant exists (optional check)
    try {
      const assistantCheck = await fetch(`https://api.openai.com/v1/assistants/${assistantId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });
      
      if (assistantCheck.ok) {
        console.log("✅ Assistant verified successfully");
      } else {
        const errorText = await assistantCheck.text();
        console.warn("⚠️ Assistant verification failed:", assistantCheck.status, errorText);
      }
    } catch (verifyError) {
      console.warn("⚠️ Assistant verification error:", verifyError);
    }
    
    // Step 1: Create a thread
    const threadResponse = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({})
    });

    if (!threadResponse.ok) {
      const errorText = await threadResponse.text();
      console.error("❌ Thread creation failed:", threadResponse.status, threadResponse.statusText, errorText);
      throw new Error(`Failed to create thread: ${threadResponse.status} ${threadResponse.statusText} - ${errorText}`);
    }

    const thread = await threadResponse.json();
    const threadId = thread.id;
    console.log(`✅ Thread created: ${threadId}`);

    // Step 2: Add message to thread
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        role: 'user',
        content: message
      })
    });

    if (!messageResponse.ok) {
      const errorText = await messageResponse.text();
      console.error("❌ Message creation failed:", messageResponse.status, messageResponse.statusText, errorText);
      throw new Error(`Failed to add message: ${messageResponse.status} ${messageResponse.statusText} - ${errorText}`);
    }

    console.log("✅ Message added to thread");

    // Step 3: Run the assistant
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        assistant_id: assistantId
      })
    });

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error("❌ Assistant run failed:", runResponse.status, runResponse.statusText, errorText);
      throw new Error(`Failed to run assistant: ${runResponse.status} ${runResponse.statusText} - ${errorText}`);
    }

    const run = await runResponse.json();
    const runId = run.id;
    console.log(`✅ Assistant run started: ${runId}`);

    // Step 4: Poll for completion with shorter timeout for PartyKit
    let runStatus = 'queued';
    let attempts = 0;
    const maxAttempts = 15; // 15 seconds timeout (reduced for PartyKit)

    while (runStatus !== 'completed' && runStatus !== 'failed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      attempts++;

      try {
        const statusResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'OpenAI-Beta': 'assistants=v2'
          }
        });

        if (!statusResponse.ok) {
          console.warn(`Status check failed: ${statusResponse.status}, continuing...`);
          continue;
        }

        const statusData = await statusResponse.json();
        runStatus = statusData.status;
        console.log(`🔄 Run status: ${runStatus} (attempt ${attempts}/${maxAttempts})`);
        
        // Break early on terminal states
        if (runStatus === 'failed' || runStatus === 'cancelled' || runStatus === 'expired') {
          break;
        }
      } catch (error) {
        console.warn(`Status check error on attempt ${attempts}:`, error);
        // Continue polling unless we've exceeded max attempts
      }
    }

    if (runStatus !== 'completed') {
      throw new Error(`Assistant run failed or timed out. Status: ${runStatus} after ${attempts} attempts`);
    }

    // Step 5: Get the assistant's response
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text();
      console.error("❌ Messages retrieval failed:", messagesResponse.status, messagesResponse.statusText, errorText);
      throw new Error(`Failed to get messages: ${messagesResponse.status} ${messagesResponse.statusText} - ${errorText}`);
    }

    const messagesData = await messagesResponse.json();
    const assistantMessage = messagesData.data.find((msg: any) => msg.role === 'assistant');
    
    if (!assistantMessage || !assistantMessage.content || !assistantMessage.content[0]) {
      throw new Error("No response from assistant");
    }

    const content = assistantMessage.content[0].text.value;
    console.log("📝 Assistant response received");

    // Parse the JSON response
    try {
      const validationResults = JSON.parse(content);
      console.log("✅ OpenAI Assistant validation successful");
      return validationResults;
    } catch (parseError) {
      console.error("Failed to parse assistant response:", content);
      throw new Error("Invalid JSON response from OpenAI Assistant");
    }

  } catch (error) {
    console.error("OpenAI Assistant validation error:", error);
    throw error;
  }
}

export default class StadtLandFlussServer implements Party.Server {
  // Room ID for this game instance
  private roomId: string;
  
  constructor(readonly party: Party.Party) {
    // <<< ADD CONSTRUCTOR LOG >>>
    console.log(`[PartyKit] --- CONSTRUCTOR --- Instantiating server for party ID: ${party.id}`);
    this.roomId = party.id;
    // console.log(`New StadtLandFlussServer instance created for room ${this.roomId}`); // Keep original or remove? Keep for now.
    console.log(`[PartyKit] Constructor: Assigned roomId = ${this.roomId}`);


    // DEBUG: Check environment variables
    console.log('🔐 SERVER ENV: OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
    console.log('🔐 SERVER ENV: OPENAI_ASSISTANT_ID exists:', !!process.env.OPENAI_ASSISTANT_ID);
    console.log('🔐 SERVER ENV: OPENAI_API_KEY prefix:', process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.substring(0, 5) + '...' : 'undefined');
    
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
      console.error('❌ CRITICAL: OpenAI environment variables missing in server constructor. This will cause ChatGPT validation to fail.');
    }
    
    // Initialize room state if it doesn't exist
    if (!roomStates[this.roomId]) {
      roomStates[this.roomId] = {
        players: {},
        currentLetter: null,
        roundInProgress: false,
        roundResults: {},
        admin: "",
        timeLimit: 60,
        timerEnd: null,
        categories: [...DEFAULT_CATEGORIES],
        readyCount: 0,
      };
    }
  }

  // Get the state for this room
  private get roomState(): RoomState {
    return roomStates[this.roomId];
  }

  async onStart() {
    // Load state from storage if it exists
    const stored = await this.party.storage.get<RoomState>(`room:${this.roomId}`);
    if (stored) {
      roomStates[this.roomId] = stored;
      console.log(`Loaded existing state for room ${this.roomId} with ${Object.keys(this.roomState.players).length} players`);
    }
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    try {
      console.log(`[PartyKit] --- onConnect --- Method ENTRY for conn: ${conn.id}, room: ${this.roomId}`);
      
      // Ensure room state is initialized
      if (!this.roomState) {
        console.log(`[PartyKit] Room state not found for ${this.roomId}, initializing...`);
        roomStates[this.roomId] = {
          players: {},
          currentLetter: null,
          roundInProgress: false,
          roundResults: {},
          admin: "",
          timeLimit: 60,
          timerEnd: null,
          categories: [...DEFAULT_CATEGORIES],
          readyCount: 0,
        };
      }
      
      // First send connection ID message
      conn.send(JSON.stringify({
        type: "connection",
        id: conn.id
      }));
      
      // Count ready players
      const readyCount = Object.values(this.roomState.players).filter(p => p.isReady).length;
      
      // Then send current state
      conn.send(JSON.stringify({
        type: "joined",
        connectionId: conn.id,
        players: Object.values(this.roomState.players),
        adminId: this.roomState.admin,
        isAdmin: this.roomState.admin === conn.id,
        timeLimit: this.roomState.timeLimit,
        roundInProgress: this.roomState.roundInProgress,
        currentLetter: this.roomState.currentLetter,
        timerEnd: this.roomState.timerEnd,
        roomId: this.roomId,
        readyCount: readyCount
      }));
      console.log(`[PartyKit] onConnect: Sent initial state to ${conn.id}`);
    } catch (error) {
      console.error(`[PartyKit] Error in onConnect for ${conn.id}:`, error);
      try {
        conn.send(JSON.stringify({
          type: "error",
          message: "Connection failed"
        }));
      } catch (sendError) {
        console.error(`[PartyKit] Failed to send error message:`, sendError);
      }
    }
  }

  async onMessage(message: string, sender: Party.Connection) {
    console.log(`[PartyKit] --- onMessage --- Received message from ${sender.id}`); // <-- ADD LOG
    try {
      console.log(`[PartyKit] onMessage: Raw data from ${sender.id}:`, message.substring(0, 100) + (message.length > 100 ? '...' : '')); // Modified log

      // Check if message is a string that needs to be parsed
      let data;
      try {
        data = typeof message === 'string' ? JSON.parse(message) : message;
        console.log(`✅ Successfully parsed message from ${sender.id}: ${data.type}`);
      } catch (parseError) {
        console.error(`❌ ERROR parsing message from ${sender.id}:`, parseError);
        console.error(`❌ Raw message content:`, message);
        
        // Try to detect and fix common encoding issues
        if (typeof message === 'string' && message.startsWith('"') && message.endsWith('"')) {
          try {
            // Message might be double-encoded JSON
            const unescaped = JSON.parse(message);
            data = JSON.parse(unescaped);
            console.log(`🔧 Fixed double-encoded JSON from ${sender.id}: ${data.type}`);
          } catch (fixError) {
            console.error(`❌ Failed to fix double-encoded JSON:`, fixError);
            sender.send(JSON.stringify({
              type: "error",
              message: "Invalid message format"
            }));
            return;
          }
        } else {
          sender.send(JSON.stringify({
            type: "error",
            message: "Invalid message format"
          }));
          return;
        }
      }
      
      // Route messages to appropriate handlers
      console.log(`🎯 Routing message of type: ${data.type} from ${sender.id} in room ${this.roomId}`); // Add roomId to log
      
      // Check if this player is in the room (only for non-joinRoom messages)
      if (!this.roomState.players[sender.id] && data.type !== 'joinRoom') {
        console.log(`Player ${sender.id} is not in room ${this.roomId}`);
        sender.send(JSON.stringify({
          type: "error",
          message: "You are not in this room"
        }));
        return;
      }
      
      // Handle message based on type
      console.log(`[PartyKit] Routing message type: ${data.type} from ${sender.id}`); // <-- ADD LOG
      switch (data.type) {
        case "joinRoom":
          console.log(`[PartyKit] Routing to handleJoinRoom for ${sender.id}`); // <-- ADD LOG
          await this.handleJoinRoom(data, sender);
          break;
          
        case "playerReady":
          console.log(`[PartyKit] Routing to handlePlayerReady for ${sender.id}`); // <-- ADD LOG
          this.handlePlayerReady(data, sender);
          break;
          
        case "startGame":
        case "startRound":
          console.log(`🔄 Handling startRound message from ${sender.id}`);
          this.handleStartRound(sender);
          break;
          
        case "returnToLobby":
          console.log(`🔄 Handling returnToLobby message from ${sender.id}`);
          this.handleReturnToLobby(sender);
          break;
          
        case "submitAnswers":
          console.log(`[PartyKit] Routing to handleSubmitAnswers for ${sender.id}`); // <-- ADD LOG
          this.handleSubmitAnswers(data, sender);
          break;
          
        case "updateCategories":
          console.log(`[PartyKit] Routing to handleUpdateCategories for ${sender.id}`); // <-- ADD LOG
          this.handleUpdateCategories(data, sender);
          break;
          
        case "closeSession":
          console.log(`[PartyKit] Routing to handleCloseSession for ${sender.id}`); // <-- ADD LOG
          this.handleCloseSession(data, sender);
          break;
          
        case "echo":
          console.log(`📣 ECHO TEST from ${sender.id}: ${data.message || "No message"}`);
          // Send direct response to sender to test the connection
          sender.send(JSON.stringify({
            type: "echo-response",
            receivedAt: new Date().toISOString(),
            originalMessage: data.message || "No message"
          }));
          break;
          
        default:
          console.warn(`🚫 Unhandled message type: ${data.type} from ${sender.id}`);
      }
      
      // Save state after any message
      await this.party.storage.put(`room:${this.roomId}`, this.roomState);
    } catch (error) {
      console.error('❌ Error in onMessage:', error);
      
      // Try to send an error message to the client
      try {
      sender.send(JSON.stringify({
        type: "error",
          message: "Server error processing message"
      }));
      } catch (sendError) {
        console.error('❌ Failed to send error message:', sendError);
      }
    }
  }

  onClose(conn: Party.Connection) {
    const player = this.roomState.players[conn.id];
    if (!player) {
      console.log(`[onClose] Connection ${conn.id} closed but player not found`);
      return;
    }
    
    const playerName = player.name;
    
    console.log(`[onClose] Player ${playerName} (${conn.id}) disconnected`);
    
    // Check if room is empty (no active connections)
    const remainingPlayers = Object.keys(this.roomState.players).filter(id => id !== conn.id);
    
    if (remainingPlayers.length === 0) {
      console.log(`[onClose] Room ${this.roomId} is now empty, clearing state`);
      // Clear the room state when last player leaves
      roomStates[this.roomId] = {
        players: {},
        currentLetter: null,
        roundInProgress: false,
        roundResults: {},
        admin: "",
        timeLimit: 60,
        timerEnd: null,
        categories: [...DEFAULT_CATEGORIES],
        readyCount: 0,
      };
      this.party.storage.put(`room:${this.roomId}`, roomStates[this.roomId]);
      return;
    }
    
    // Remove the player
    let adminRemoved = false;
    if (player.isAdmin) {
      adminRemoved = true;
    }
    
    delete this.roomState.players[conn.id];
    
    // If admin left, assign new admin
    if (adminRemoved && remainingPlayers.length > 0) {
      const newAdminId = remainingPlayers[0];
      this.roomState.admin = newAdminId;
      this.roomState.players[newAdminId].isAdmin = true;
      
      console.log(`[onClose] Admin left, assigned new admin: ${newAdminId}`);
      
      // Notify remaining players about new admin
      this.party.broadcast(JSON.stringify({
        type: "adminChanged",
        newAdminId: newAdminId,
        players: Object.values(this.roomState.players),
        message: "New host assigned"
      }));
    }
    
    // Update ready count
    this.roomState.readyCount = Object.values(this.roomState.players).filter(p => p.isReady).length;
    
    // Save state
    this.party.storage.put(`room:${this.roomId}`, this.roomState);
    
    // Broadcast player left to remaining players
    this.party.broadcast(JSON.stringify({
      type: "playerLeft",
      playerId: conn.id,
      playerName: playerName,
      players: Object.values(this.roomState.players),
      adminId: this.roomState.admin,
      readyCount: this.roomState.readyCount
    }));
    
    console.log(`[onClose] Player ${conn.id} removed. Remaining players: ${remainingPlayers.length}`);
  }

  // HTTP request handler to serve static files
  async onRequest(req: Party.Request) {
    // PartyKit automatically serves static files from the public directory
    // We don't need to handle static file serving manually
    // This method should only handle API requests if needed
    
    const url = new URL(req.url);
    console.log(`[PartyKit] HTTP Request: ${req.method} ${url.pathname}`);
    
    // For now, just return a simple response for any HTTP requests
    // PartyKit will handle static file serving automatically
    return new Response('PartyKit Server Running', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }

  private handleJoinRoom(data: any, sender: Party.Connection) {
    const playerName = data.playerName || `Player ${sender.id}`;
    const requestedRoomId = data.roomId;
    const isReconnect = data.isReconnect || false;
    const timeLimit = data.timeLimit || 60;
    
    console.log(`[handleJoinRoom] Player ${playerName} (${sender.id}) joining room ${this.roomId}`);
    console.log(`[handleJoinRoom] Requested room ID: "${requestedRoomId}"`);
    console.log(`[handleJoinRoom] Current players: ${Object.keys(this.roomState.players).length}`);
    console.log(`[handleJoinRoom] Current admin: ${this.roomState.admin}`);
    
    const isFirstPlayer = Object.keys(this.roomState.players).length === 0;
    const isCreatingNewRoom = !requestedRoomId || requestedRoomId.trim() === '';
    
    // Determine if this player should be admin
    let shouldBeAdmin = false;
    
    if (isFirstPlayer) {
      // First player in the room becomes admin
      shouldBeAdmin = true;
      this.roomState.admin = sender.id;
      console.log(`[handleJoinRoom] First player - setting as admin`);
    } else if (isCreatingNewRoom && !this.roomState.admin) {
      // If someone is trying to create a new room but room exists without admin, they become admin
      shouldBeAdmin = true;
      console.log(`[handleJoinRoom] No admin exists - setting as admin`);
    } else if (sender.id === this.roomState.admin) {
      // Current connection ID matches admin ID
      shouldBeAdmin = true;
      console.log(`[handleJoinRoom] Connection ID matches admin ID`);
    }
    
    // Set admin if this player should be admin
    if (shouldBeAdmin) {
      this.roomState.admin = sender.id;
      console.log(`[handleJoinRoom] Setting ${sender.id} as admin`);
    }
    
    // Update time limit if this is the admin setting it
    if (shouldBeAdmin && timeLimit !== this.roomState.timeLimit) {
      this.roomState.timeLimit = timeLimit;
      console.log(`[handleJoinRoom] Admin set time limit to ${timeLimit}`);
    }
    
    // Create or update player
    this.roomState.players[sender.id] = {
      id: sender.id,
      name: playerName,
      answers: {},
      score: 0,
      isAdmin: shouldBeAdmin,
      submitted: false,
      isReady: false,
    };
    
    // Count ready players
    const readyCount = Object.values(this.roomState.players).filter(p => p.isReady).length;
    this.roomState.readyCount = readyCount;
    
    // Save state
    this.party.storage.put(`room:${this.roomId}`, this.roomState);
    
    // Send individual response to the joining player first
    sender.send(JSON.stringify({
      type: "joinedRoom",
      roomId: this.roomId,
      playerId: sender.id,
      players: Object.values(this.roomState.players),
      adminId: this.roomState.admin,
      isAdmin: shouldBeAdmin,
      categories: this.roomState.categories,
      timeLimit: this.roomState.timeLimit,
      readyCount: readyCount,
      isReconnect: isReconnect
    }));
    
    // Then broadcast to everyone else (if there are others)
    if (Object.keys(this.roomState.players).length > 1) {
      this.party.broadcast(JSON.stringify({
        type: "playerJoined",
        player: this.roomState.players[sender.id],
        players: Object.values(this.roomState.players),
        adminId: this.roomState.admin,
        readyCount: readyCount,
        isReconnect: isReconnect
      }), [sender.id]); // Exclude the sender from broadcast
    }
    
    console.log(`[handleJoinRoom] Successfully added player ${sender.id}. Admin: ${this.roomState.admin}, Players: ${Object.keys(this.roomState.players).length}`);
  }

  private handleStartRound(sender: Party.Connection) {
    if (this.roomState.roundInProgress) {
      console.log("Round already in progress");
      return;
    }
    
    // Check if sender is admin
    const isAdmin = this.roomState.players[sender.id]?.isAdmin;
    console.log(`StartRound request from ${sender.id}. Is admin? ${isAdmin}`);
    
    if (!isAdmin) {
      console.log("Non-admin tried to start round");
      sender.send(JSON.stringify({ type: "error", message: "Only the admin can start a round" }));
      return;
    }
    
    console.log(`Starting round for room ${this.roomId}`);

    // Get random letter (excluding difficult letters)
    const letters = "ABCDEFGHIJKLMNOPRSTUVWZ"; // Exclude Q, X, Y
    const randomLetter = letters.charAt(Math.floor(Math.random() * letters.length));
    this.roomState.currentLetter = randomLetter;
    this.roomState.roundInProgress = true;
    
    // Reset submission state for all players
    Object.values(this.roomState.players).forEach(player => {
      player.submitted = false;
      player.answers = {};
    });

    const timeLimit = this.roomState.timeLimit || 60; // Default: 60 seconds
    const timerEnd = new Date(Date.now() + timeLimit * 1000);
    this.roomState.timerEnd = timerEnd;
    
    // Save state
    this.party.storage.put(`room:${this.roomId}`, this.roomState);

    // Broadcast to all players
    const broadcastMessage = JSON.stringify({
      type: "roundStarted",
      letter: randomLetter,
      timeLimit: timeLimit,
      categories: this.roomState.categories
    });
    this.party.broadcast(broadcastMessage);
    
    // IMPORTANT FIX: Also send a direct confirmation to the sender
    // This ensures the admin gets a response even if broadcast fails
    sender.send(broadcastMessage);
  }

  private handleSubmitAnswers(data: any, sender: Party.Connection) {
    // Add extensive debug logging
    console.log(`🔍 SUBMIT_ANSWERS HANDLER START for player ${sender.id}`);
    console.log(`🔍 Room state:`, {
      roundInProgress: this.roomState.roundInProgress,
      currentLetter: this.roomState.currentLetter,
      playersCount: Object.keys(this.roomState.players).length
    });
    
    // Log extensive information for debugging
    console.log(`[PartyKit] --- Entering handleSubmitAnswers for ${sender.id} ---`); // <-- ADD LOG

    const player = this.roomState.players[sender.id];

    if (!player) {
      console.error(`⚠️ SUBMISSION ERROR: Player ${sender.id} not found when submitting answers`);
      sender.send(JSON.stringify({ 
        type: "error", 
        message: "Player not found in room" 
      }));
      return;
    }
    
    if (!this.roomState.roundInProgress) {
      console.error(`⚠️ SUBMISSION ERROR: Player ${sender.id} tried to submit answers but no round is in progress`);
      sender.send(JSON.stringify({
        type: "error",
        message: "No round in progress"
      }));
      return;
    }
    
    if (player.submitted) {
      console.log(`ℹ️ Player ${sender.id} already submitted answers, ignoring duplicate`);
      
      // Send acknowledgment directly to the player to avoid client-side timeout
      try {
        console.log(`🔍 Sending duplicate submission acknowledgment to ${sender.id}`);
        sender.send(JSON.stringify({
          type: "error",
          message: "Your answers have already been received"
        }));
        console.log(`✅ Sent duplicate submission acknowledgment successfully`);
      } catch (error) {
        console.error(`❌ Failed to send duplicate submission acknowledgment:`, error);
      }
      return;
    }
    
    // Log answers with current letter for debugging
    console.log(`⬆️ SUBMISSION for letter ${this.roomState.currentLetter}:`, data.answers);
    
    // Save answers
    player.answers = data.answers;
    player.submitted = true;
    
    // Count submitted players and check if all players have submitted
    const allPlayers = Object.values(this.roomState.players);
    const submittedCount = allPlayers.filter(p => p.submitted).length;
    
    console.log(`⬆️ SUBMISSION: ${submittedCount}/${allPlayers.length} players have submitted`);
    
    // Send an immediate acknowledgment to the sender using a known message type
    console.log(`⬆️ SUBMISSION: Sending acknowledgment to player ${sender.id}`);
    try {
      sender.send(JSON.stringify({
        type: "playerSubmitted",
        playerId: sender.id,
        playerName: player.name,
        submitted: true,
        message: "Answers submitted successfully!"
      }));
      console.log(`✅ Sent submission acknowledgment successfully`);
    } catch (error) {
      console.error(`❌ Failed to send submission acknowledgment:`, error);
    }
    
    // Broadcast player submission status update to all players
    console.log(`⬆️ SUBMISSION: Broadcasting submission status update`);
    try {
    this.party.broadcast(JSON.stringify({
      type: "playerSubmitted",
      playerId: sender.id,
        playerName: player.name,
        submittedCount: submittedCount,
        totalPlayers: allPlayers.length
      }));
      console.log(`✅ Broadcast submission status update successfully`);
    } catch (error) {
      console.error(`❌ Failed to broadcast submission status:`, error);
    }
    
    // Check if all players have submitted or if time has expired
    const allSubmitted = submittedCount === allPlayers.length;
    const timeExpired = this.roomState.timerEnd ? new Date() > this.roomState.timerEnd : false;
    
    if (allSubmitted || timeExpired) {
      console.log(`[PartyKit] Condition met for validation: allSubmitted=${allSubmitted}, timeExpired=${timeExpired}`);

      // Immediately notify all players that validation is starting
      this.party.broadcast(JSON.stringify({
        type: "validationStarted",
        message: "All players submitted! Processing results with AI..."
      }));

      // Call processValidation as a non-blocking operation with better error handling
      this.processValidation().catch(error => {
        console.error('❌ [PartyKit] Critical error during processValidation:', error);
        
        // Send error message to all players
        this.party.broadcast(JSON.stringify({
          type: "validationError",
          message: "Validation failed. Please try again.",
          error: error.message
        }));
        
        // Reset round state so players can try again
        this.roomState.roundInProgress = false;
        Object.values(this.roomState.players).forEach(player => {
          player.submitted = false;
        });
      });
    } else {
      console.log(`[PartyKit] Waiting for ${allPlayers.length - submittedCount} more players to submit`);
    }
    
    console.log(`🔍 SUBMIT_ANSWERS HANDLER END for player ${sender.id}`);
  }

  private async processValidation() {
    console.log(`[PartyKit] --- Entering processValidation for room ${this.roomId} ---`);
    // Check roundInProgress *after* logging entry
    if (!this.roomState.roundInProgress) {
        console.log(`[PartyKit] processValidation aborted: roundInProgress is false.`);
        return;
    }
    
    // Get all player answers
    const playerAnswers: Record<string, Record<string, string>> = {};
    let allPlayersSubmitted = true;
    
    Object.entries(this.roomState.players).forEach(([playerId, player]) => {
      // Check if player has submitted answers
      if (!player.submitted || Object.keys(player.answers).length === 0) {
        allPlayersSubmitted = false;
      } else {
        playerAnswers[playerId] = player.answers;
      }
    });
    
    // If not all players have submitted, don't process yet
    if (!allPlayersSubmitted) return;
    
    console.log(`All players submitted answers in room ${this.roomId}, validating...`);
    
    // Mark round as ended to prevent multiple validations
    this.roomState.roundInProgress = false;
    
    try {
      console.log("⏱️ VALIDATION: Starting AI validation process");
      const startTime = Date.now();
      
      // Use OpenAI API for validation
      console.log("⏱️ VALIDATION: Using OpenAI API for validation");
      
      let validationResults;
      try {
        validationResults = await validateAnswersWithOpenAI(
          this.roomState.currentLetter || 'A',
          playerAnswers,
          this.roomState.categories
        );
        console.log("✅ OpenAI validation completed successfully");
      } catch (error) {
        console.error("❌ OpenAI validation failed, using fallback:", error);
        
        // Fallback to simple validation if OpenAI fails
        validationResults = {};
        Object.entries(playerAnswers).forEach(([playerId, answers]) => {
          validationResults[playerId] = {};
          
          this.roomState.categories.forEach(category => {
            const answer = answers[category] || '';
            const isValid = answer.trim().length > 0;
            
            validationResults[playerId][category] = {
              valid: isValid,
              explanation: isValid ? "Answer provided (AI validation failed)" : "No answer provided"
            };
          });
        });
      }

      console.log(`⏱️ VALIDATION: AI Validator completed in ${Date.now() - startTime}ms`);
      
      // Check if we got valid results
      if (!validationResults || Object.keys(validationResults).length === 0) {
        throw new Error("Empty validation results returned from AI");
      }
      
      console.log(`AI Validation completed successfully for room ${this.roomId}`);
      
      // Initialize structured results
      const structuredScores: Record<string, Record<string, any>> = {};
      
      // Process validation results into expected structure
      this.roomState.categories.forEach(category => {
        structuredScores[category] = {};
        
        // For each player, create an entry for this category
        Object.keys(playerAnswers).forEach(playerId => {
          const playerAnswer = playerAnswers[playerId][category] || '';
          
          // Initialize with default values
          structuredScores[category][playerId] = {
            answer: playerAnswer,
            score: 0,
            explanation: "No answer provided"
          };
          
          if (playerAnswer) {
            // Get the validation result for this category
            const categoryValidation = validationResults[playerId]?.[category];
            
            // Add debugging to see what validation results we're getting
            console.log(`🔍 VALIDATION DEBUG for ${category}:"${playerAnswer}":`, categoryValidation);
            
            if (categoryValidation) {
              // Use the AI's explanation
              structuredScores[category][playerId].explanation = categoryValidation.explanation;
              
              // Determine score based on validation - be more strict
              if (categoryValidation.valid === true) {
                // Check if answer is unique
                const isUnique = this.isUniqueAnswer(playerAnswer, category, playerAnswers);
                structuredScores[category][playerId].score = isUnique ? 20 : 10;
                console.log(`✅ VALID: "${playerAnswer}" for ${category} - Score: ${isUnique ? 20 : 10}`);
              } else {
                structuredScores[category][playerId].score = 0;
                console.log(`❌ INVALID: "${playerAnswer}" for ${category} - Score: 0`);
              }
              
              // Add suggestions if available
              if (categoryValidation.suggestions) {
                structuredScores[category][playerId].suggestion = categoryValidation.suggestions;
              }
            } else {
              throw new Error(`No validation result for player ${playerId}, category ${category}, answer "${playerAnswer}"`);
            }
          }
        });
      });
      
      // Update player scores
      Object.entries(structuredScores).forEach(([category, categoryScores]) => {
        Object.entries(categoryScores).forEach(([playerId, scoreData]) => {
          if (this.roomState.players[playerId]) {
            this.roomState.players[playerId].score += scoreData.score || 0;
          }
        });
      });
      
      // Send results to all players
      console.log(`📢 Broadcasting round results for room ${this.roomId}`);
      this.party.broadcast(JSON.stringify({
        type: "roundResults",
        scores: structuredScores,
        players: Object.values(this.roomState.players),
        categories: this.roomState.categories
      }));
      console.log(`✅ Broadcast successful`);
      
      // Store results
      this.roomState.roundResults = structuredScores;
      
    } catch (error) {
      console.error("❌ AI VALIDATION FAILED:", error);
      
      // Send clear error message to all players
      this.party.broadcast(JSON.stringify({
        type: "validationError",
        message: "AI validation failed. Please try again or contact support.",
        error: error.message
      }));
      
      // Reset round state so they can try again
      this.roomState.roundInProgress = false;
      Object.values(this.roomState.players).forEach(player => {
        player.submitted = false;
      });
    }
  }
  
  // Helper function to check if an answer is unique among all players
  private isUniqueAnswer(answer: string, category: string, allAnswers: Record<string, Record<string, string>>): boolean {
    // If there's only one player, all answers are considered unique
    if (Object.keys(allAnswers).length <= 1) {
      return true;
    }
    
    // Count occurrences of this answer for this category
    let count = 0;
    Object.values(allAnswers).forEach(playerAnswers => {
      if (playerAnswers[category]?.toLowerCase() === answer.toLowerCase()) {
        count++;
      }
    });
    return count === 1;
  }

  // Add new method to handle category updates
  private handleUpdateCategories(data: any, sender: Party.Connection) {
    const categories = data.categories;
    
    if (!categories || categories.length === 0) {
      sender.send(JSON.stringify({
        type: "error",
        message: "Invalid categories"
      }));
      return;
    }
    
    // No longer enforce required categories - use whatever the client sends
    this.roomState.categories = categories;
    
    // Save state
    this.party.storage.put(`room:${this.roomId}`, this.roomState);
    
    // Notify everyone in the room
    this.party.broadcast(JSON.stringify({
      type: "categoriesUpdated",
      categories: this.roomState.categories
    }));
  }

  private handlePlayerReady(data: any, sender: Party.Connection) {
    const isReady = data.isReady;
    const player = this.roomState.players[sender.id];
    const playerName = data.playerName || player?.name || 'Unknown';

    console.log(`[handlePlayerReady] Player ${playerName} (${sender.id}) setting ready to: ${isReady}`);
    console.log(`[handlePlayerReady] Player found: ${!!player}`);
    
    if (!player) {
      console.error(`[handlePlayerReady] Player ${sender.id} not found in room ${this.roomId}`);
      sender.send(JSON.stringify({
        type: "error",
        message: "Player not found in room"
      }));
      return;
    }

    console.log(`[handlePlayerReady] Current player state: isReady=${player.isReady}, room readyCount=${this.roomState.readyCount}`);

    // Only update if the state actually changed
      if (player.isReady !== isReady) {
      const oldReadyState = player.isReady;
      player.isReady = isReady;

      // Update ready count
      if (isReady && !oldReadyState) {
          this.roomState.readyCount++;
      } else if (!isReady && oldReadyState) {
          this.roomState.readyCount = Math.max(0, this.roomState.readyCount - 1);
        }

      console.log(`[handlePlayerReady] Updated player ${sender.id}: ${oldReadyState} -> ${isReady}`);
      console.log(`[handlePlayerReady] Ready count: ${this.roomState.readyCount}/${Object.keys(this.roomState.players).length}`);

      // Send direct confirmation to the player first
      sender.send(JSON.stringify({
        type: "player-ready-update",
        playerId: sender.id,
        isReady: isReady,
        readyCount: this.roomState.readyCount,
        players: Object.values(this.roomState.players)
      }));

      // Then broadcast to all players
      this.party.broadcast(JSON.stringify({
          type: "player-ready-update",
        playerId: sender.id,
        isReady: isReady,
          readyCount: this.roomState.readyCount,
          players: Object.values(this.roomState.players)
      }));

      console.log(`[handlePlayerReady] Broadcasted ready update for ${sender.id}`);
      } else {
      console.log(`[handlePlayerReady] No state change needed for player ${sender.id} (already ${isReady})`);
      
      // Still send confirmation to avoid client timeout
      sender.send(JSON.stringify({
        type: "player-ready-update",
        playerId: sender.id,
        isReady: isReady,
        readyCount: this.roomState.readyCount,
        players: Object.values(this.roomState.players)
      }));
    }
  }

  private handleReturnToLobby(sender: Party.Connection) {
    console.log(`[handleReturnToLobby] Return to lobby request from ${sender.id}`);
    
    // Check if sender is admin
    const isAdmin = this.roomState.players[sender.id]?.isAdmin;
    console.log(`[handleReturnToLobby] Is admin: ${isAdmin}`);
    
    if (!isAdmin) {
      console.log("[handleReturnToLobby] Non-admin tried to return to lobby");
      sender.send(JSON.stringify({ 
        type: "error", 
        message: "Only the host can proceed to the next round" 
      }));
      return;
    }
    
    console.log(`[handleReturnToLobby] Returning all players to lobby for room ${this.roomId}`);
    
    // Reset all players' ready status and submitted status
    Object.values(this.roomState.players).forEach(player => {
      player.isReady = false;
      player.submitted = false;
      player.answers = {};
    });
    
    // Reset room state for next round
    this.roomState.roundInProgress = false;
    this.roomState.currentLetter = null;
    this.roomState.timerEnd = null;
    this.roomState.readyCount = 0;
    this.roomState.roundResults = {};
    
    // Save state
    this.party.storage.put(`room:${this.roomId}`, this.roomState);
    
    // Send return to lobby message to all players
    const lobbyMessage = JSON.stringify({
      type: "returnToLobby",
      players: Object.values(this.roomState.players),
      adminId: this.roomState.admin,
      readyCount: 0,
      message: "Round completed! Ready up for the next round."
    });
    
    try {
      console.log(`[handleReturnToLobby] Broadcasting return to lobby message to all players`);
      this.party.broadcast(lobbyMessage);
      console.log(`[handleReturnToLobby] Broadcast successful`);
    } catch (error) {
      console.error(`[handleReturnToLobby] Error broadcasting lobby message:`, error);
    }
    
    console.log(`[handleReturnToLobby] Successfully returned all players to lobby for room ${this.roomId}`);
  }

  private handleCloseSession(data: any, sender: Party.Connection) {
    console.log(`[handleCloseSession] Close session request from ${sender.id}`);
    
    // Check if sender is admin
    const isAdmin = this.roomState.players[sender.id]?.isAdmin;
    console.log(`[handleCloseSession] Is admin: ${isAdmin}`);
    
    if (!isAdmin) {
      console.log("[handleCloseSession] Non-admin tried to close session");
      sender.send(JSON.stringify({ 
        type: "error", 
        message: "Only the host can close the session" 
      }));
      return;
    }
    
    const reason = data.reason || "Session closed by host";
    console.log(`[handleCloseSession] Closing session for room ${this.roomId}. Reason: ${reason}`);
    
    // Send session closed message to all players
    const closeMessage = JSON.stringify({
      type: "sessionClosed",
      reason: reason,
      message: "The host has closed this session. You will be disconnected."
    });
    
    try {
      console.log(`[handleCloseSession] Broadcasting session closed message to all players`);
      this.party.broadcast(closeMessage);
      console.log(`[handleCloseSession] Broadcast successful`);
    } catch (error) {
      console.error(`[handleCloseSession] Error broadcasting close message:`, error);
    }
    
    // Clear the room state
    console.log(`[handleCloseSession] Clearing room state for ${this.roomId}`);
    roomStates[this.roomId] = {
      players: {},
      currentLetter: null,
      roundInProgress: false,
      roundResults: {},
      admin: "",
      timeLimit: 60,
      timerEnd: null,
      categories: [...DEFAULT_CATEGORIES],
      readyCount: 0,
    };
    
    // Clear storage
    try {
      this.party.storage.delete(`room:${this.roomId}`);
      console.log(`[handleCloseSession] Cleared storage for room ${this.roomId}`);
    } catch (error) {
      console.error(`[handleCloseSession] Error clearing storage:`, error);
    }
    
    // Close all connections after a short delay to ensure message delivery
    setTimeout(() => {
      console.log(`[handleCloseSession] Closing all connections for room ${this.roomId}`);
      
      // Get all connections and close them
      const connections = Array.from(this.party.getConnections());
      connections.forEach(conn => {
        try {
          conn.close(1000, "Session closed by host");
        } catch (error) {
          console.error(`[handleCloseSession] Error closing connection ${conn.id}:`, error);
        }
      });
      
      console.log(`[handleCloseSession] Session ${this.roomId} closed successfully`);
    }, 1000); // 1 second delay to ensure message delivery
  }
}
