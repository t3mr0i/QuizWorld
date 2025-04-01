import type * as Party from "partykit/server";
import { validateAnswers } from "../server/chatgpt-validator";
import fs from "fs";
import path from "path";

// Game constants
const CATEGORIES = ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Pflanze', 'Tier'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Room state interface
interface Player {
  id: string;
  name: string;
  answers: Record<string, string>;
  score: number;
  isAdmin: boolean;
  submitted: boolean;
}

interface RoomState {
  players: Record<string, Player>;
  currentLetter: string | null;
  roundInProgress: boolean;
  roundResults: Record<string, any>;
  admin: string;
  timeLimit: number;
  timerEnd: Date | null;
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
        timerEnd: null
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
      roomId: this.roomId
    }));
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message);
      
      // If message contains roomId, use it to update our roomId
      // Only update the room ID when joining, not for other actions
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
            timerEnd: null
          };
        }
      }
      
      switch (data.type) {
        case "joinRoom":
          this.handleJoinRoom(data, sender);
          break;
        case "startRound":
          this.handleStartRound(sender);
          break;
        case "submitAnswers":
          this.handleSubmitAnswers(data, sender);
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
          timerEnd: null
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
    // Get the player name and preferred room ID
    const playerName = data.playerName || `Player ${sender.id.substring(0, 6)}`;
    
    // Don't override the room ID from handleJoinRoom and don't change it during the game
    // Only preserve the original roomId from the request
    if (data.roomId) {
      console.log(`${playerName} (${sender.id}) is joining room ${data.roomId}`);
    } else {
      console.log(`${playerName} (${sender.id}) is joining room ${this.roomId}`);
    }
    
    // Set time limit if provided
    if (data.timeLimit) {
      this.roomState.timeLimit = data.timeLimit;
    }
    
    // First player becomes admin
    const isFirstPlayer = Object.keys(this.roomState.players).length === 0;
    
    // Add player to room
    this.roomState.players[sender.id] = {
      id: sender.id,
      name: playerName,
      answers: {},
      score: 0,
      isAdmin: isFirstPlayer,
      submitted: false
    };
    
    // If no admin, make this player the admin
    if (!this.roomState.admin || isFirstPlayer) {
      this.roomState.admin = sender.id;
      this.roomState.players[sender.id].isAdmin = true;
    }
    
    // Log admin status for debugging
    console.log(`Player ${sender.id} (${playerName}) joining room ${this.roomId} - Admin: ${sender.id === this.roomState.admin}`);
    console.log(`Room ${this.roomId} now has ${Object.keys(this.roomState.players).length} players`);
    
    // Notify all players of new player
    this.party.broadcast(JSON.stringify({
      type: "joinedRoom",
      playerId: sender.id,
      playerName: playerName,
      players: Object.values(this.roomState.players),
      adminId: this.roomState.admin,
      isAdmin: sender.id === this.roomState.admin,
      timeLimit: this.roomState.timeLimit,
      roomId: this.roomId
    }));
  }

  private handleStartRound(sender: Party.Connection) {
    // Allow any player to start the round
    console.log(`Player ${sender.id} started a new round in room ${this.roomId}`);
    
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
    
    // Reset player answers and submission status
    Object.keys(this.roomState.players).forEach(playerId => {
      this.roomState.players[playerId].answers = {};
      this.roomState.players[playerId].submitted = false;
    });
    
    // Notify everyone in the room
    this.party.broadcast(JSON.stringify({
      type: "roundStarted",
      letter,
      timeLimit,
      timerEnd: timerEnd.toISOString() // Send as ISO string for cross-platform compatibility
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
      // Get scores from validator
      const scores = await validateAnswers(
        this.roomState.currentLetter || 'A',
        playerAnswers
      );
      
      console.log(`Validation completed for room ${this.roomId}`);
      
      // Initialize structured results
      const structuredScores: Record<string, Record<string, any>> = {};
      
      // Process validation results into expected structure
      CATEGORIES.forEach(category => {
        structuredScores[category] = {};
        
        // For each player, create an entry for this category
        Object.keys(playerAnswers).forEach(playerId => {
          const playerAnswer = playerAnswers[playerId][category] || '';
          
          // Initialize with default values
          structuredScores[category][playerId] = {
            answer: playerAnswer,
            score: 0,
            explanation: "No valid answer provided"
          };
          
          // If we have suggestions, add them
          if (scores.suggestions && scores.suggestions[category]) {
            structuredScores[category][playerId].suggestion = scores.suggestions[category];
          }
          
          // If we have explanations, add them
          if (scores.explanations && scores.explanations[category]) {
            structuredScores[category][playerId].explanation = scores.explanations[category];
          }
          
          // Special case for a unique valid answer (20 points)
          if (playerAnswer && this.isUniqueAnswer(playerAnswer, category, playerAnswers)) {
            structuredScores[category][playerId].score = 20;
            structuredScores[category][playerId].explanation = "Unique valid answer (+20 points)";
          }
          // Valid but not unique (10 points)
          else if (playerAnswer && playerAnswer.toLowerCase().startsWith(this.roomState.currentLetter?.toLowerCase() || '')) {
            structuredScores[category][playerId].score = 10;
            structuredScores[category][playerId].explanation = "Valid answer (+10 points)";
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
        players: Object.values(this.roomState.players)
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
    // Count occurrences of this answer for this category
    let count = 0;
    Object.values(allAnswers).forEach(playerAnswers => {
      if (playerAnswers[category]?.toLowerCase() === answer.toLowerCase()) {
        count++;
      }
    });
    return count === 1;
  }
} 