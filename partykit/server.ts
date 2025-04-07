import type * as Party from "partykit/server";
import { validateAnswers } from "../server/chatgpt-validator";
import fs from "fs";
import path from "path";

// Game constants
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Room state interface
interface Player {
  id: string;
  name: string;
  answers: Record<string, string>;
  score: number;
  isAdmin: boolean;
  submitted: boolean;
  isReady: boolean;
}

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

export default class StadtLandFlussServer implements Party.Server {
  // Room ID for this game instance
  private roomId: string;
  
  constructor(readonly party: Party.Party) {
    // Get the room ID from the constructor party.id
    this.roomId = party.id;
    
    console.log(`PartyKit server created for room: ${this.roomId}`);
    
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
        readyCount: 0
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
    console.log(`Player connected: ${conn.id} in room: ${this.roomId}`);
    
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
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message);
      console.log(`Received message from ${sender.id}:`, data.type);
      
      // If message contains roomId, use it to update our roomId
      if (data.type === "joinRoom" && data.roomId && data.roomId !== this.roomId) {
        console.log(`Changing room from ${this.roomId} to ${data.roomId}`);
        this.roomId = data.roomId;
        
        // Initialize room state if needed
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
            readyCount: 0
          };
        }
      }
      
      // Check if this player is in the room (only for non-joinRoom messages)
      // --- START ADDED LOGS ---
      console.log(`[onMessage Check] About to check if player ${sender.id} is in room.`);
      console.log(`[onMessage Check] Current players in roomState:`, Object.keys(this.roomState.players));
      console.log(`[onMessage Check] Does roomState contain sender ${sender.id}?`, !!this.roomState.players[sender.id]);
      console.log(`[onMessage Check] Message type: ${data.type}`);
      // --- END ADDED LOGS ---
      if (!this.roomState.players[sender.id] && data.type !== 'joinRoom') {
        console.log(`Player ${sender.id} is not in room ${this.roomId}`);
        sender.send(JSON.stringify({
          type: "error",
          message: "You are not in this room"
        }));
        console.log(`[onMessage Check] Player ${sender.id} REJECTED.`); // Add log here
        return;
      }
      console.log(`[onMessage Check] Player ${sender.id} ACCEPTED for processing.`); // Add log here
      
      // Handle message based on type
      switch (data.type) {
        case "joinRoom":
          await this.handleJoinRoom(data, sender);
          break;
          
        case "startRound":
          // Now allow any player to start if enough players are ready
          console.log(`📣 Received startRound message from ${sender.id} - using updated code from ${new Date().toISOString()}`);
          this.handleStartRound(sender);
          break;
          
        case "submitAnswers":
          this.handleSubmitAnswers(data, sender);
          
          // For single player: if there's only one player, immediately process validation
          const playerCount = Object.keys(this.roomState.players).length;
          if (playerCount === 1) {
            console.log('Single player mode: immediately processing validation');
            this.processValidation();
          }
          break;
          
        case "updateCategories":
        case "update-categories":
          this.handleUpdateCategories(data, sender);
          break;
          
        case "playerReady":
          this.handlePlayerReady(data, sender);
          break;
          
        default:
          console.log(`Unknown message type: ${data.type}`);
      }
      
      // Save state after any message
      await this.party.storage.put(`room:${this.roomId}`, this.roomState);
    } catch (error) {
      console.error("Error handling message:", error);
      sender.send(JSON.stringify({
        type: "error",
        message: "Error processing your request"
      }));
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`Player disconnected: ${conn.id} from room ${this.roomId}`);
    
    // Remove player from room
    if (this.roomState.players[conn.id]) {
      const playerName = this.roomState.players[conn.id].name;
      delete this.roomState.players[conn.id];
      
      // If room is empty, leave the state as is (it will be cleaned up eventually)
      if (Object.keys(this.roomState.players).length === 0) {
        console.log(`Room ${this.roomId} is now empty`);
      } 
      // If admin left, assign a new admin
      else if (this.roomState.admin === conn.id) {
        const newAdminId = Object.keys(this.roomState.players)[0];
        this.roomState.admin = newAdminId;
        this.roomState.players[newAdminId].isAdmin = true;
        
        console.log(`Admin left, new admin is ${newAdminId}`);
        
        // Notify remaining players about new admin
        this.party.broadcast(JSON.stringify({
          type: "playerLeft",
          players: Object.values(this.roomState.players),
          adminId: this.roomState.admin,
          timeLimit: this.roomState.timeLimit
        }));
      } else {
        // Notify remaining players that someone left
        this.party.broadcast(JSON.stringify({
          type: "playerLeft",
          playerId: conn.id,
          playerName: playerName,
          players: Object.values(this.roomState.players)
        }));
      }
      
      // Save state when a player disconnects
      this.party.storage.put(`room:${this.roomId}`, this.roomState);
    }
  }

  // HTTP request handler to serve static files
  async onRequest(req: Party.Request) {
    const url = new URL(req.url);
    
    // Extract roomId from URL if present and update room state
    const roomIdParam = url.searchParams.get("roomId");
    if (roomIdParam) {
      this.roomId = roomIdParam;
      
      // Initialize room state if needed
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
          readyCount: 0
        };
      }
    }
    
    let filePath = url.pathname;
    
    // Handle root request, serve index.html
    if (filePath === '/' || filePath === '') {
      filePath = '/index.html';
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
    const categories = data.categories;
    const isFirstPlayer = Object.keys(this.roomState.players).length === 0;
    
    // Set admin if this is the first player
    if (isFirstPlayer) {
      this.roomState.admin = sender.id;
    }
    
    // Check if this player is already in the room
    const existingPlayer = this.roomState.players[sender.id];
    
    // Initialize or update player
    this.roomState.players[sender.id] = {
      id: sender.id,
      name: playerName,
      answers: {},
      score: existingPlayer?.score || 0,
      isAdmin: isFirstPlayer || sender.id === this.roomState.admin,
      submitted: false,
      isReady: existingPlayer?.isReady || false
    };
    
    // Update categories if provided
    if (categories && categories.length > 0) {
      // No longer enforce required categories - use whatever the client sends
      this.roomState.categories = categories;
    }
    
    // Count ready players
    const readyCount = Object.values(this.roomState.players).filter(p => p.isReady).length;
    this.roomState.readyCount = readyCount;
    
    // Notify everyone in the room
    this.party.broadcast(JSON.stringify({
      type: "joinedRoom",
      roomId: this.roomId,
      playerId: sender.id,
      players: Object.values(this.roomState.players),
      adminId: this.roomState.admin,
      categories: this.roomState.categories,
      readyCount: readyCount
    }));
    
    // --- START ADDED LOG ---
    console.log(`[handleJoinRoom] Successfully added/updated player ${sender.id}. Players now:`, Object.keys(this.roomState.players));
    // --- END ADDED LOG ---
  }

  private handleStartRound(sender: Party.Connection) {
    console.log('====== USING UPDATED handleStartRound WITH READY SYSTEM ======');
    
    // Check if enough players are ready to start the game
    const totalPlayers = Object.keys(this.roomState.players).length;
    const readyPlayers = Object.values(this.roomState.players).filter(p => p.isReady).length;
    const requiredReady = totalPlayers <= 2 ? totalPlayers : Math.ceil(totalPlayers / 2);
    
    // Allow game to start if: player is admin OR enough players are ready
    const isAdmin = sender.id === this.roomState.admin;
    const enoughPlayersReady = readyPlayers >= requiredReady;
    
    if (!isAdmin && !enoughPlayersReady) {
      console.log(`Player ${sender.id} tried to start game but not enough players are ready (${readyPlayers}/${requiredReady})`);
      // Send error message to the player
      sender.send(JSON.stringify({
        type: "error",
        message: `Not enough players are ready to start the game. Need at least ${requiredReady} ready players.`
      }));
      return;
    }
    
    console.log(`${isAdmin ? 'Admin' : 'Player'} ${sender.id} started a new round in room ${this.roomId} with ${readyPlayers}/${totalPlayers} players ready`);
    
    // Select a random letter
    const randomIndex = Math.floor(Math.random() * LETTERS.length);
    const letter = LETTERS[randomIndex];
    
    // Set round timer
    const timeLimit = this.roomState.timeLimit;
    const timerEnd = new Date(Date.now() + timeLimit * 1000);
    
    // Update room state
    this.roomState.currentLetter = letter;
    this.roomState.roundInProgress = true;
    this.roomState.roundResults = {};
    this.roomState.timerEnd = timerEnd;
    
    // Reset player answers, submission status, and ready status
    Object.keys(this.roomState.players).forEach(playerId => {
      this.roomState.players[playerId].answers = {};
      this.roomState.players[playerId].submitted = false;
      this.roomState.players[playerId].isReady = false;
    });
    
    // Reset readyCount
    this.roomState.readyCount = 0;
    
    // Notify everyone in the room
    this.party.broadcast(JSON.stringify({
      type: "roundStarted",
      letter,
      timeLimit,
      timerEnd: timerEnd.toISOString(), // Send as ISO string for cross-platform compatibility
      categories: this.roomState.categories // Include current categories
    }));
  }

  private handleSubmitAnswers(data: any, sender: Party.Connection) {
    if (!this.roomState.roundInProgress) {
      sender.send(JSON.stringify({
        type: "error",
        message: "No round in progress"
      }));
      return;
    }
    
    console.log(`Player ${sender.id} submitted answers in room ${this.roomId}`);
    
    // Store player answers
    this.roomState.players[sender.id].answers = data.answers || {};
    
    // Mark player as submitted
    this.roomState.players[sender.id].submitted = true;
    
    // Notify that answers were received
    this.party.broadcast(JSON.stringify({
      type: "playerSubmitted",
      playerId: sender.id,
      players: Object.values(this.roomState.players)
    }));
    
    // Process round if all players have submitted
    this.processValidation();
  }

  private async processValidation() {
    if (!this.roomState.roundInProgress) return;
    
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
      // Get validation results from OpenAI
      const validationResults = await validateAnswers(
        this.roomState.currentLetter || 'A',
        playerAnswers,
        this.roomState.categories // Pass current categories to validator
      );
      
      console.log(`Validation completed for room ${this.roomId}`);
      
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
      
      // Update player scores
      Object.entries(structuredScores).forEach(([category, categoryScores]) => {
        Object.entries(categoryScores).forEach(([playerId, scoreData]) => {
          if (this.roomState.players[playerId]) {
            this.roomState.players[playerId].score += scoreData.score || 0;
          }
        });
      });
      
      // Send results to all players
      this.party.broadcast(JSON.stringify({
        type: "roundResults",
        scores: structuredScores,
        players: Object.values(this.roomState.players),
        categories: this.roomState.categories // Include current categories
      }));
      
      // Store results
      this.roomState.roundResults = structuredScores;
      
      // Save state
      await this.party.storage.put(`room:${this.roomId}`, this.roomState);
    } catch (error) {
      console.error(`Error validating answers in room ${this.roomId}:`, error);
      
      // Notify players of error
      this.party.broadcast(JSON.stringify({
        type: "error",
        message: "Error validating answers"
      }));
      
      // Reset round state so players can try again
      this.roomState.roundInProgress = false;
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
    const player = this.roomState.players[sender.id]; // Get player object
    const playerName = data.playerName || player?.name || 'Unknown';

    // --- START ADDED LOGS ---
    console.log("--- Server handlePlayerReady ---");
    console.log("Received data:", JSON.stringify(data));
    console.log(`Sender ID: ${sender.id}`);
    console.log(`Player found: ${!!player}`);
    if (player) {
        console.log(`Current player state before update: isReady=${player.isReady}`);
        console.log(`Room readyCount before update: ${this.roomState.readyCount}`);
    }
    // --- END ADDED LOGS ---

    console.log(`✅✅✅ READY SYSTEM: Player ${playerName} (${sender.id}) in room ${this.roomId} is now ${isReady ? 'ready' : 'not ready'} [${new Date().toISOString()}]`);

    if (player) {
      if (player.isReady !== isReady) {
        player.isReady = isReady; // Update state directly on player object

        if (isReady) {
          this.roomState.readyCount++;
        } else {
          this.roomState.readyCount = Math.max(0, this.roomState.readyCount - 1);
        }

        // --- START ADDED LOGS ---
        console.log(`Player state after update: isReady=${player.isReady}`);
        console.log(`Room readyCount after update: ${this.roomState.readyCount}`);
        // --- END ADDED LOGS ---

        console.log(`Ready count for room ${this.roomId} is now ${this.roomState.readyCount}/${Object.keys(this.roomState.players).length}`);

        const broadcastMessage = JSON.stringify({
          type: "player-ready-update",
          readyCount: this.roomState.readyCount,
          players: Object.values(this.roomState.players)
        });
        // --- START ADDED LOGS ---
        console.log("Broadcasting message:", broadcastMessage.substring(0, 500) + (broadcastMessage.length > 500 ? '...' : '')); // Log first 500 chars
        // --- END ADDED LOGS ---
        this.party.broadcast(broadcastMessage);

      } else {
           // --- START ADDED LOGS ---
           console.log(`No state change needed for player ${sender.id}. Current state: ${player.isReady}, Received: ${isReady}`);
           // --- END ADDED LOGS ---
      }
    } else {
      console.error(`Player ${sender.id} not found in room ${this.roomId}`);
    }
    // --- START ADDED LOGS ---
    console.log("--- End Server handlePlayerReady ---");
    // --- END ADDED LOGS ---
  }
} 