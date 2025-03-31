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
  constructor(readonly party: Party.Party) {
    console.log(`PartyKit server created for room: ${this.party.id}`);
  }

  // Store for the game state
  private roomState: RoomState = {
    players: {},
    currentLetter: null,
    roundInProgress: false,
    roundResults: {},
    admin: "",
    timeLimit: 60,
    timerEnd: null
  };

  async onStart() {
    // Load state from storage if it exists
    const stored = await this.party.storage.get<RoomState>("roomState");
    if (stored) {
      this.roomState = stored;
      console.log(`Loaded existing state for room ${this.party.id} with ${Object.keys(this.roomState.players).length} players`);
    }
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`Player connected: ${conn.id} in room: ${this.party.id}`);
    
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
      roomId: this.party.id
    }));
  }

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message);
      
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
      await this.party.storage.put("roomState", this.roomState);
    } catch (error) {
      console.error("Error handling message:", error);
      sender.send(JSON.stringify({
        type: "error",
        message: "Error processing your request"
      }));
    }
  }

  onClose(conn: Party.Connection) {
    console.log(`Player disconnected: ${conn.id} from room ${this.party.id}`);
    
    // Remove player from room
    if (this.roomState.players[conn.id]) {
      const playerName = this.roomState.players[conn.id].name;
      delete this.roomState.players[conn.id];
      
      // If room is empty, leave the state as is (it will be cleaned up eventually)
      if (Object.keys(this.roomState.players).length === 0) {
        console.log(`Room ${this.party.id} is now empty`);
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
      this.party.storage.put("roomState", this.roomState);
    }
  }

  // HTTP request handler to serve static files
  async onRequest(req: Party.Request) {
    const url = new URL(req.url);
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
    const { playerName, timeLimit } = data;
    const roomId = this.party.id; // Use the PartyKit room ID
    
    console.log(`${playerName} (${sender.id}) is joining room ${roomId}`);
    
    // Initialize admin if this is the first player
    if (Object.keys(this.roomState.players).length === 0) {
      this.roomState.admin = sender.id;
      this.roomState.timeLimit = timeLimit || 60;
    }
    
    // Add player to room
    this.roomState.players[sender.id] = {
      id: sender.id,
      name: playerName,
      answers: {},
      score: 0,
      isAdmin: this.roomState.admin === sender.id,
      submitted: false
    };
    
    // Log players for debugging
    console.log(`Room ${roomId} now has ${Object.keys(this.roomState.players).length} players`);
    
    // Send confirmation to the joining player
    sender.send(JSON.stringify({
      type: "joined",
      roomId: this.party.id,
      players: Object.values(this.roomState.players),
      adminId: this.roomState.admin,
      isAdmin: this.roomState.admin === sender.id,
      timeLimit: this.roomState.timeLimit
    }));
    
    // Notify everyone else in the room
    this.party.broadcast(
      JSON.stringify({
        type: "playerJoined",
        players: Object.values(this.roomState.players),
        adminId: this.roomState.admin,
        timeLimit: this.roomState.timeLimit
      }), 
      [sender.id] // Exclude the sender
    );
  }

  private handleStartRound(sender: Party.Connection) {
    // Allow any player to start the round
    console.log(`Player ${sender.id} started a new round in room ${this.party.id}`);
    
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
    
    console.log(`Player ${sender.id} submitted answers in room ${this.party.id}`);
    
    // Store player answers
    this.roomState.players[sender.id].answers = data.answers || {};
    
    // Mark player as submitted
    this.roomState.players[sender.id].submitted = true;
    
    // Notify that answers were received
    this.party.broadcast(JSON.stringify({
      type: "answerReceived",
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
    
    console.log(`All players submitted answers in room ${this.party.id}, validating...`);
    
    // Mark round as ended to prevent multiple validations
    this.roomState.roundInProgress = false;
    
    try {
      // Get scores from validator
      const scores = await validateAnswers(
        this.roomState.currentLetter || 'A',
        playerAnswers
      );
      
      console.log(`Validation completed for room ${this.party.id}`);
      
      // Update player scores
      if (scores && typeof scores === 'object') {
        Object.entries(scores).forEach(([category, categoryScores]) => {
          if (categoryScores && typeof categoryScores === 'object') {
            Object.entries(categoryScores as Record<string, unknown>).forEach(([playerId, scoreData]) => {
              if (this.roomState.players[playerId] && scoreData) {
                const score = typeof scoreData === 'object' && scoreData !== null && 'score' in scoreData 
                  ? (scoreData as {score: number}).score
                  : 0;
                this.roomState.players[playerId].score += score;
              }
            });
          }
        });
      }
      
      // Send results to all players
      this.party.broadcast(JSON.stringify({
        type: "roundResults",
        scores,
        players: Object.values(this.roomState.players)
      }));
      
      // Store results
      this.roomState.roundResults = scores;
      
      // Save state
      await this.party.storage.put("roomState", this.roomState);
    } catch (error) {
      console.error(`Error validating answers in room ${this.party.id}:`, error);
      
      // Notify players of error
      this.party.broadcast(JSON.stringify({
        type: "error",
        message: "Error validating answers"
      }));
      
      // Reset round state so players can try again
      this.roomState.roundInProgress = false;
    }
  }
} 