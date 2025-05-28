import type * as Party from "partykit/server";
import { validateAnswers } from "../server/chatgpt-validator";
import fs from "fs";
import path from "path";

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

// Add a simple inline validator function for fallback
// This is for when the external validator module doesn't work
function inlineValidateAnswers(letter: string, playerAnswers: Record<string, Record<string, string>>, categories: string[]): Record<string, Record<string, any>> {
  console.log('🔍 INLINE VALIDATOR: Running simple inline validation');
  console.log(`🔍 INLINE VALIDATOR: Letter: ${letter}, Categories: ${categories.join(', ')}`);
  
  const results: Record<string, Record<string, any>> = {};
  
  Object.keys(playerAnswers).forEach(playerId => {
    results[playerId] = {};
    const answers = playerAnswers[playerId];
    
    Object.keys(answers).forEach(category => {
      const answer = answers[category];
      const isValid = answer && answer.length > 0 && answer.toLowerCase().startsWith(letter.toLowerCase());
      
      results[playerId][category] = {
        valid: isValid,
        explanation: isValid 
          ? `"${answer}" ist eine gültige Antwort für ${category}.` 
          : `"${answer}" ist ungültig oder beginnt nicht mit dem Buchstaben ${letter.toUpperCase()}.`,
        suggestions: null
      };
    });
  });
  
  console.log('🔍 INLINE VALIDATOR: Validation complete');
  return results;
}

// Fetch polyfill for direct API calls
async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }) {
  const { timeout = 10000, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// Direct OpenAI API call as another fallback
async function directOpenAIValidation(letter: string, playerAnswers: Record<string, Record<string, string>>, categories: string[]): Promise<Record<string, Record<string, any>>> {
  console.log('🔍 DIRECT API: Attempting direct OpenAI API call');
  
  try {
    // Try simplified validation with GPT-3.5
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('API key not available');
    }
    
    const prompt = `
      Validate the following answers for the game Stadt-Land-Fluss with the letter "${letter}":
      
      Categories: ${categories.join(', ')}
      
      Answers:
      ${Object.entries(playerAnswers).map(([playerId, answers]) => 
        `Player ${playerId}:\n${Object.entries(answers).map(([category, answer]) => 
          `- ${category}: "${answer}"`).join('\n')}`
      ).join('\n\n')}
      
      Rules:
      1. Each answer must start with the letter "${letter}" (case insensitive)
      2. The answer must be real and accurate for its category
      3. Answers that don't follow these rules are invalid
      
      Please provide validation results as a JSON object with the following structure:
      {
        "playerId1": {
          "category1": { "valid": true/false, "explanation": "reason" },
          "category2": { "valid": true/false, "explanation": "reason" }
        },
        "playerId2": {
          ...
        }
      }
    `;
    
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000
      }),
      timeout: 8000 // 8 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }
    
    // Try to parse JSON from the response
    try {
      // Find JSON in the response - look for anything between curly braces
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const validationResults = JSON.parse(jsonMatch[0]);
      console.log('🔍 DIRECT API: Successfully parsed validation results');
      return validationResults;
    } catch (parseError) {
      console.error('🔍 DIRECT API: Error parsing response:', parseError);
      throw parseError;
    }
  } catch (error) {
    console.error('🔍 DIRECT API: Error calling OpenAI API directly:', error);
    
    // Return a simple validation as fallback
    console.log('🔍 DIRECT API: Using simple validation as ultimate fallback');
    return inlineValidateAnswers(letter, playerAnswers, categories);
  }
}

// Define a type for our validator module
interface ValidatorModule {
  validateAnswers: (letter: string, answers: any, categories: string[]) => Promise<any>;
}

let validatorModule: ValidatorModule | null = null;
let validatorLoadAttempted = false;

// Try to load the validator module immediately
try {
  console.log("🚀 SERVER STARTING: Attempting to preload validator");
  import("../server/chatgpt-validator.js").then(module => {
    validatorModule = module as ValidatorModule;
    console.log("✅ SERVER: Successfully preloaded validator module");
  }).catch(error => {
    console.error("❌ SERVER: Failed to preload validator module:", error.message);
    validatorLoadAttempted = true;
  });
} catch (error) {
  console.error("❌ SERVER: Error in preload validator attempt:", error);
  validatorLoadAttempted = true;
}

// Embedded validator functions that don't require external modules
/**
 * Direct OpenAI API call for validation when module import fails
 */
async function embeddedValidateAnswers(letter: string, playerAnswers: Record<string, Record<string, string>>, categories: string[]): Promise<Record<string, Record<string, any>>> {
  console.log('🔍 EMBEDDED: validateAnswers called with letter:', letter);
  console.log('📦 EMBEDDED: Categories to validate:', categories);
  console.log('📦 EMBEDDED: Answers to validate:', JSON.stringify(playerAnswers, null, 2));
  
  const API_KEY = process.env.OPENAI_API_KEY;
  
  if (!API_KEY) {
    console.warn('⚠️ EMBEDDED: OpenAI API Key not set. Using basic validation.');
    return basicValidateAnswers(letter, playerAnswers, categories);
  }
  
  try {
    // Create validation prompt
    const validationPrompt = JSON.stringify({
      task: "Validate user-submitted answers for the game 'Stadt, Land, Fluss'.",
      rules: {
        general: "Each answer must start with the specified letter and fit the category. Be EXTREMELY strict with validation and make sure answers are REAL and ACCURATE. ALWAYS ANSWER IN GERMAN",
        categories: {
          Stadt: "Must be a real, existing city or town with official city rights.",
          Land: "Must be a recognized sovereign country, federal state, or well-known historical region.",
          Fluss: "Must be a real, existing river.",
          Name: "Must be a commonly recognized first name used for people.",
          Beruf: "Must be a recognized official profession or occupation.",
          Pflanze: "Must be a specific plant species, including trees, flowers, or crops.",
          Tier: "Must be a specific animal species, using either scientific or common name.",
          "*": "For any other category, validate that the answer is real, accurate, and fits the category's theme."
        }
      },
      letter,
      answers: playerAnswers,
      categories,
      output_format: {
        valid: "Boolean indicating if ALL answers are valid",
        errors: "Array of strings describing validation errors for specific answers",
        suggestions: "Object with category keys and string values containing alternate suggestions that start with the required letter",
        explanations: "Object with category keys and string values containing brief explanations for each valid answer AND invalid answer"
      }
    });

    console.log(`EMBEDDED: Sending validation request for letter ${letter}`);
    
    // Make direct API call to OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a validator for the game 'Stadt Land Fluss'. Validate if answers start with the given letter and are correct for their categories."
          },
          {
            role: "user",
            content: validationPrompt
          }
        ],
        temperature: 0.2
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('EMBEDDED: OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data || !data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response from OpenAI API');
    }
    
    const content = data.choices[0].message.content;
    console.log('EMBEDDED: Raw validation response:', content);
    
    try {
      // Remove any comments from the JSON string before parsing
      const cleanedJson = content.replace(/\/\/.*$/gm, '').trim();
      // Try to parse the response as JSON
      const parsedResponse = JSON.parse(cleanedJson);
      console.log('EMBEDDED: Parsed validation result:', parsedResponse);
      
      // Process the validation results
      const playerResults: Record<string, Record<string, any>> = {};
      
      // For each player's answers
      Object.entries(playerAnswers).forEach(([playerId, answers]) => {
        playerResults[playerId] = {};
        
        // For each category
        Object.entries(answers).forEach(([category, answer]) => {
          if (!answer) {
            playerResults[playerId][category] = {
              valid: false,
              explanation: "Keine Antwort angegeben",
              suggestions: null
            };
            return;
          }
          
          // Get the validation result for this category
          const categoryValidation = {
            valid: parsedResponse.valid,
            explanation: parsedResponse.explanations?.[category] || "Keine Erklärung verfügbar",
            suggestions: parsedResponse.suggestions?.[category] || null
          };
          
          // Check if the answer starts with the correct letter
          if (!answer.toLowerCase().startsWith(letter.toLowerCase())) {
            categoryValidation.valid = false;
            categoryValidation.explanation = `"${answer}" beginnt nicht mit dem Buchstaben "${letter}".`;
            categoryValidation.suggestions = null;
          }
          
          playerResults[playerId][category] = categoryValidation;
        });
      });
      
      return playerResults;
    } catch (e) {
      console.error('EMBEDDED: Failed to parse OpenAI response as JSON:', e);
      return basicValidateAnswers(letter, playerAnswers, categories);
    }
  } catch (error) {
    console.error('EMBEDDED: Error in validateAnswers:', error);
    return basicValidateAnswers(letter, playerAnswers, categories);
  }
}

/**
 * Basic validation when OpenAI API fails
 */
function basicValidateAnswers(letter: string, playerAnswers: Record<string, Record<string, string>>, categories: string[]): Record<string, Record<string, any>> {
  console.log('🔍 BASIC: Performing basic validation for letter:', letter);
  
  const playerResults: Record<string, Record<string, any>> = {};
  
  Object.entries(playerAnswers).forEach(([playerId, answers]) => {
    playerResults[playerId] = {};
    
    Object.entries(answers).forEach(([category, answer]) => {
      if (!answer) {
        playerResults[playerId][category] = {
          valid: false,
          explanation: "Keine Antwort angegeben",
          suggestions: null
        };
        return;
      }
      
      const startsWithLetter = answer.toLowerCase().startsWith(letter.toLowerCase());
      
      playerResults[playerId][category] = {
        valid: startsWithLetter,
        explanation: startsWithLetter 
          ? `"${answer}" ist eine gültige Antwort für ${category}.`
          : `"${answer}" beginnt nicht mit dem Buchstaben "${letter}".`,
        suggestions: null
      };
    });
  });
  
  return playerResults;
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
    // <<< ADD LOG AT VERY BEGINNING >>>
    console.log(`[PartyKit] --- onConnect --- Method ENTRY for conn: ${conn.id}, room: ${this.roomId}`);
    // console.log(`[PartyKit] --- onConnect --- Player attempting to connect: ${conn.id} to room: ${this.roomId}`); // Keep original or remove? Keep for now.
    
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
    console.log(`[PartyKit] onConnect: Sent initial state to ${conn.id}`); // <-- ADD LOG
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
    const url = new URL(req.url);
    
    // Serve static files from the "public" directory
    const filePath = path.join(__dirname, "..", "public", url.pathname === "/" ? "index.html" : url.pathname);
    const safeFilePath = path.resolve(filePath); // Resolve to prevent path traversal
    const publicDir = path.resolve(path.join(__dirname, "..", "public"));

    // Security check: ensure the resolved path is still within the public directory
    if (!safeFilePath.startsWith(publicDir)) {
      return new Response("Forbidden", { status: 403 });
    }
    
    try {
      // Use a relative path from the project root
      // PartyKit runs in the project root directory
      const fullPath = `./public${filePath}`;
      
      // Check if file exists and read it
      const content = await fs.promises.readFile(fullPath);
      
      // Determine content type
      const ext = path.extname(fullPath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': contentType,
        },
      });
    } catch (error) {
      console.error(`Error serving file for path ${filePath}:`, error);
      
      // Return 404 for file not found
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new Response(`File not found: ${filePath}`, { status: 404 });
      }
      
      // Return 500 for other errors
      return new Response('Internal Server Error', { status: 500 });
    }
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
          type: "submission-ack",
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
    
    // Send an immediate acknowledgment to the sender
    console.log(`⬆️ SUBMISSION: Sending acknowledgment to player ${sender.id}`);
    try {
      sender.send(JSON.stringify({
        type: "submission-ack",
        submitted: true
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
      console.log(`[PartyKit] Condition met for validation: allSubmitted=${allSubmitted}, timeExpired=${timeExpired}`); // <-- ADD LOG

      // Immediately notify all players that validation is starting
      this.party.broadcast(JSON.stringify({
        type: "validationStarted",
        message: "All players submitted! Processing results with AI..."
      }));

      // Call processValidation as a non-blocking operation
      setTimeout(() => {
        console.log(`[PartyKit] Calling processValidation in setTimeout for room ${this.roomId}`); // <-- ADD LOG
        this.processValidation().catch(error => {
          console.error('❌ [PartyKit] Error during async processValidation call:', error);
        });
      }, 0);
    } else {
      console.log(`[PartyKit] Waiting for ${allPlayers.length - submittedCount} more players to submit`); // <-- Modified LOG
    }
    
    console.log(`🔍 SUBMIT_ANSWERS HANDLER END for player ${sender.id}`);
  }

  private async processValidation() {
    console.log(`[PartyKit] --- Entering processValidation for room ${this.roomId} ---`); // <-- ADD LOG
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
      console.log("⏱️ VALIDATION: Starting validation process");
      const startTime = Date.now();
      
      // Get validation results
      let validationResults;
      try {
        // Check if the validator module was successfully preloaded
        if (validatorModule && typeof validatorModule.validateAnswers === 'function') {
          console.log("⏱️ VALIDATION: Using preloaded validator module");
          validationResults = await validatorModule.validateAnswers(
        this.roomState.currentLetter || 'A',
        playerAnswers,
            this.roomState.categories
          );
          console.log("⏱️ VALIDATION: Preloaded validator completed successfully");
        } 
        // Try dynamic import if preload failed
        else if (!validatorLoadAttempted) {
          console.log("⏱️ VALIDATION: Attempting dynamic import of validator");
          try {
            const validator = await import("../server/chatgpt-validator.js");
            console.log("⏱️ VALIDATION: Dynamic import successful, validator is:", typeof validator);
            
            if (validator && typeof validator.validateAnswers === 'function') {
              console.log("⏱️ VALIDATION: Using dynamically imported validator");
              validationResults = await validator.validateAnswers(
                this.roomState.currentLetter || 'A',
                playerAnswers,
                this.roomState.categories
              );
              console.log("⏱️ VALIDATION: Dynamic import validator completed successfully");
            } else {
              console.error("⏱️ VALIDATION: Dynamic import failed to get validateAnswers function");
              throw new Error("Dynamic import failed");
            }
          } catch (importError) {
            console.error("⏱️ VALIDATION: Dynamic import error:", importError);
            throw importError; // Propagate to the next fallback
          }
        }
        else {
          // If preload failed and dynamic import wasn't attempted or failed, throw error to trigger next fallback
          console.error("⏱️ VALIDATION: Preload and dynamic import failed. Proceeding to direct API call fallback.");
          throw new Error("Validator module loading failed");
        }

        console.log(`⏱️ VALIDATION: Validator completed in ${Date.now() - startTime}ms`);
        
        // Check if we got valid results
        if (!validationResults || Object.keys(validationResults).length === 0) {
          console.error("⚠️ VALIDATION: Empty results returned from validator");
          throw new Error("Empty validation results");
        }
      } catch (validationError) {
        console.error("⚠️ VALIDATION ERROR:", validationError);
        
        // Try direct API call as another fallback
        try {
          console.log("⏱️ VALIDATION: Trying direct OpenAI API call");
          validationResults = await directOpenAIValidation(
            this.roomState.currentLetter || 'A',
            playerAnswers,
            this.roomState.categories
          );
          console.log("⏱️ VALIDATION: Direct API call completed successfully");
        } catch (directApiError) {
          console.error("⏱️ VALIDATION: Direct API call failed:", directApiError);
          
          // Try our embedded validator as another fallback
          try {
            console.log("⏱️ VALIDATION: Trying embedded validator");
            validationResults = await embeddedValidateAnswers(
              this.roomState.currentLetter || 'A',
              playerAnswers,
              this.roomState.categories
            );
            console.log("⏱️ VALIDATION: Embedded validator completed successfully");
          } catch (embeddedError) {
            console.error("⏱️ VALIDATION: Embedded validator failed:", embeddedError);
            
            // Use inline validator as final fallback
            console.log("⏱️ VALIDATION: Using inline validator as final fallback");
            validationResults = inlineValidateAnswers(
              this.roomState.currentLetter || 'A',
              playerAnswers,
              this.roomState.categories
            );
            console.log("⏱️ VALIDATION: Inline validator completed");
          }
        }
      }
      
      console.log(`Validation completed for room ${this.roomId}`);
      
      // Initialize structured results
      const structuredScores: Record<string, Record<string, any>> = {};
      
      try {
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
            
            if (categoryValidation) {
              // Use the AI's explanation
              structuredScores[category][playerId].explanation = categoryValidation.explanation;
              
              // Determine score based on validation
              if (categoryValidation.valid) {
                // Check if answer is unique
                const isUnique = this.isUniqueAnswer(playerAnswer, category, playerAnswers);
                structuredScores[category][playerId].score = isUnique ? 20 : 10;
              } else {
                structuredScores[category][playerId].score = 0;
              }
              
              // Add suggestions if available
              if (categoryValidation.suggestions) {
                structuredScores[category][playerId].suggestion = categoryValidation.suggestions;
              }
            } else {
              // Fallback if no validation result
              structuredScores[category][playerId].explanation = "Answer could not be validated";
            }
          }
        });
      });
      } catch (processingError) {
        console.error("⚠️ ERROR processing validation results:", processingError);
        
        // If processing fails, create a simple scoring object
        this.roomState.categories.forEach(category => {
          structuredScores[category] = {};
          
          Object.keys(playerAnswers).forEach(playerId => {
            const answer = playerAnswers[playerId][category] || '';
            const letter = this.roomState.currentLetter?.toLowerCase() || 'a';
            const isValid = answer.length > 0 && answer.toLowerCase().startsWith(letter);
            
            structuredScores[category][playerId] = {
              answer: answer,
              score: isValid ? 10 : 0,  // Give 10 points for any valid answer as a fallback
              explanation: isValid 
                ? `"${answer}" ist eine gültige Antwort für ${category}.` 
                : `"${answer}" ist ungültig oder beginnt nicht mit dem Buchstaben ${this.roomState.currentLetter}.`
            };
          });
        });
      }
      
      // Update player scores
      Object.entries(structuredScores).forEach(([category, categoryScores]) => {
        Object.entries(categoryScores).forEach(([playerId, scoreData]) => {
          if (this.roomState.players[playerId]) {
            this.roomState.players[playerId].score += scoreData.score || 0;
          }
        });
      });
      
      // Send results to all players
      try {
        console.log(`📢 Broadcasting round results for room ${this.roomId}`);
      this.party.broadcast(JSON.stringify({
        type: "roundResults",
        scores: structuredScores,
        players: Object.values(this.roomState.players),
        categories: this.roomState.categories // Include current categories
      }));
        console.log(`✅ Broadcast successful`);
      } catch (broadcastError) {
        console.error(`❌ Error broadcasting round results:`, broadcastError);
      }
      
      // Store results
      this.roomState.roundResults = structuredScores;
      
      // Save state
      // await this.party.storage.put(`room:${this.roomId}`, this.roomState);
      // Save state moved to end of onMessage for consistency
      
    } catch (error) {
      console.error("❌ Final error processing validation results:", error);
      // Attempt to send error back to clients if validation failed catastrophically
      try {
      this.party.broadcast(JSON.stringify({
        type: "error",
              message: "Failed to process round results due to server error."
      }));
      } catch (broadcastError) {
          console.error("❌ Failed to broadcast final validation error:", broadcastError);
      }
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

  // Simple fallback validation - does basic checks without calling OpenAI
  private performSimpleValidation(allAnswers: Record<string, Record<string, string>>) {
    console.log("Running simple validation fallback");
    const results: Record<string, Record<string, any>> = {};
    
    Object.keys(allAnswers).forEach(playerId => {
      results[playerId] = {};
      const playerAnswers = allAnswers[playerId];
      
      Object.keys(playerAnswers).forEach(category => {
        const answer = playerAnswers[category] || '';
        const letter = this.roomState.currentLetter?.toLowerCase() || 'a';
        
        // Basic validation: answer must start with the letter
        const isValid = answer.length > 0 && answer.toLowerCase().startsWith(letter);
        
        results[playerId][category] = {
          valid: isValid,
          explanation: isValid 
            ? `"${answer}" ist eine gültige Antwort für ${category}.` 
            : `"${answer}" ist ungültig oder beginnt nicht mit dem Buchstaben ${this.roomState.currentLetter}.`,
          suggestions: null
        };
      });
    });
    
    return results;
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
