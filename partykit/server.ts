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
  isReady: boolean;
  isAdmin: boolean;
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
  constructor(readonly party: Party.Party) {}

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
    }
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`Player connected: ${conn.id}`);
    // Send current state to the new connection
    conn.send(JSON.stringify({
      type: "init",
      players: Object.values(this.roomState.players),
      admin: this.roomState.admin,
      timeLimit: this.roomState.timeLimit,
      roundInProgress: this.roomState.roundInProgress,
      currentLetter: this.roomState.currentLetter,
      timerEnd: this.roomState.timerEnd
    }));
  }

  async onMessage(message: string, sender: Party.Connection) {
    const data = JSON.parse(message);
    
    switch (data.type) {
      case "joinRoom":
        this.handleJoinRoom(data, sender);
        break;
      case "startRound":
        this.handleStartRound(sender);
        break;
      case "submitAnswers":
        this.handleSubmitAnswers(data.answers, sender);
        break;
    }
    
    // Save state after any message
    await this.party.storage.put("roomState", this.roomState);
  }

  onClose(conn: Party.Connection) {
    console.log(`Player disconnected: ${conn.id}`);
    
    // Remove player from room
    if (this.roomState.players[conn.id]) {
      const playerName = this.roomState.players[conn.id].name;
      delete this.roomState.players[conn.id];
      
      // If room is empty, leave the state as is (it will be cleaned up eventually)
      if (Object.keys(this.roomState.players).length === 0) {
        console.log("Room is empty");
      } 
      // If admin left, assign a new admin
      else if (this.roomState.admin === conn.id) {
        const newAdminId = Object.keys(this.roomState.players)[0];
        this.roomState.admin = newAdminId;
        this.roomState.players[newAdminId].isAdmin = true;
        
        console.log(`Admin left, new admin is ${newAdminId}`);
        
        // Notify remaining players about new admin
        this.party.broadcast(JSON.stringify({
          type: "newAdmin",
          admin: this.roomState.admin
        }));
      }
      
      // Notify remaining players
      this.party.broadcast(JSON.stringify({
        type: "playerLeft",
        playerId: conn.id,
        playerName: playerName,
        players: Object.values(this.roomState.players)
      }));
      
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
      
      // Log the path we're trying to serve for debugging
      console.log(`Attempting to serve: ${fullPath}`);
      
      // Check if file exists and read it
      const content = await fs.promises.readFile(fullPath);
      
      // Determine content type
      const ext = path.extname(fullPath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      
      console.log(`Successfully serving: ${fullPath} as ${contentType}`);
      
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
    const { playerName, roomId, timeLimit } = data;
    
    console.log(`${playerName} (${sender.id}) is joining room`);
    
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
      isReady: false,
      isAdmin: this.roomState.admin === sender.id
    };
    
    // Log players for debugging
    console.log(`Room now has ${Object.keys(this.roomState.players).length} players`);
    
    // Notify everyone in the room
    this.party.broadcast(JSON.stringify({
      type: "playerJoined",
      players: Object.values(this.roomState.players),
      admin: this.roomState.admin,
      timeLimit: this.roomState.timeLimit
    }));
  }

  private handleStartRound(sender: Party.Connection) {
    // Only admin can start the round
    if (this.roomState.admin !== sender.id) return;
    
    console.log(`Admin ${sender.id} started new round`);
    
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
    
    // Reset player answers and readiness
    Object.keys(this.roomState.players).forEach(playerId => {
      this.roomState.players[playerId].answers = {};
      this.roomState.players[playerId].isReady = false;
    });
    
    // Notify everyone in the room
    this.party.broadcast(JSON.stringify({
      type: "roundStarted",
      letter,
      timeLimit,
      players: Object.values(this.roomState.players)
    }));
    
    // Set server-side timer to end the round
    setTimeout(() => {
      if (this.roomState.roundInProgress) {
        console.log(`Time's up for round`);
        this.processRoundEnd();
      }
    }, timeLimit * 1000);
  }

  private handleSubmitAnswers(answers: Record<string, string>, sender: Party.Connection) {
    if (!this.roomState.roundInProgress) return;
    
    console.log(`Player ${sender.id} submitted answers`);
    
    // Store player answers
    this.roomState.players[sender.id].answers = answers;
    this.roomState.players[sender.id].isReady = true;
    
    // Check if all players are ready
    const allReady = Object.values(this.roomState.players).every(player => player.isReady);
    
    if (allReady) {
      // Process round results
      this.processRoundEnd();
    } else {
      // Notify others that this player is ready
      this.party.broadcast(JSON.stringify({
        type: "playerReady",
        playerId: sender.id,
        players: Object.values(this.roomState.players)
      }));
    }
  }

  private async processRoundEnd() {
    if (!this.roomState.roundInProgress) return;
    
    // Mark round as no longer in progress
    this.roomState.roundInProgress = false;
    
    // Validate and score the round
    await this.validateAndScoreRound();
  }

  private async validateAndScoreRound() {
    // Mark round as finished
    this.roomState.roundInProgress = false;
    
    // Get the current letter
    const letter = this.roomState.currentLetter;
    
    // Collect all answers for validation
    const playerAnswers: Record<string, Record<string, string>> = {};
    const playerIds = Object.keys(this.roomState.players);
    
    // Prepare answers for validation
    for (const playerId of playerIds) {
      const player = this.roomState.players[playerId];
      playerAnswers[playerId] = player.answers;
    }
    
    // Validate with OpenAI (using your existing validator)
    try {
      // Fix the validateAnswers call based on the actual function signature
      // The function signature is: validateAnswers(letter, answers)
      const validationResults = await validateAnswers(
        letter || 'A',
        playerAnswers
      );
      
      // Process and store results
      const scores: Record<string, any> = {};
      
      // Initialize scores for each category and player
      CATEGORIES.forEach(category => {
        scores[category] = {};
        playerIds.forEach(playerId => {
          const answer = playerAnswers[playerId][category];
          scores[category][playerId] = {
            answer: answer || '',
            score: 0,
            unique: false,
          };
        });
      });
      
      // Manual scoring since the ChatGPT validator doesn't provide score per answer
      playerIds.forEach(playerId => {
        CATEGORIES.forEach(category => {
          const answer = playerAnswers[playerId][category]?.trim();
          if (!answer) return;
          
          // Check if the answer is valid (starts with the letter)
          const isValid = answer.toLowerCase().startsWith((letter || 'A').toLowerCase());
          
          // Check if the answer is unique among players
          const isUnique = playerIds.filter(
            id => playerAnswers[id][category]?.toLowerCase() === answer.toLowerCase()
          ).length === 1;
          
          // Score: 20 for unique valid, 10 for non-unique valid, 0 for invalid
          let score = 0;
          if (isValid) {
            score = isUnique ? 20 : 10;
          }
          
          // Save to scores object
          if (scores[category] && scores[category][playerId]) {
            scores[category][playerId].score = score;
            scores[category][playerId].unique = isUnique;
          }
        });
      });
      
      // Check validation errors from ChatGPT and apply them
      if (validationResults && validationResults.errors) {
        validationResults.errors.forEach((error: string) => {
          // Try to extract category and playerId from error message
          // This is a simplified approach
          CATEGORIES.forEach(category => {
            if (error.includes(category)) {
              playerIds.forEach(playerId => {
                if (scores[category] && scores[category][playerId]) {
                  scores[category][playerId].errors = [error];
                  scores[category][playerId].score = 0; // Invalid answer gets 0 points
                }
              });
            }
          });
        });
      }
      
      // Update player scores
      playerIds.forEach(playerId => {
        let totalScore = 0;
        
        CATEGORIES.forEach(category => {
          if (scores[category][playerId]) {
            totalScore += scores[category][playerId].score;
          }
        });
        
        this.roomState.players[playerId].score += totalScore;
      });
      
      // Send round results to all players
      this.party.broadcast(JSON.stringify({
        type: "roundResults",
        scores,
        players: Object.values(this.roomState.players)
      }));
      
      // Save state after validation
      await this.party.storage.put("roomState", this.roomState);
      
    } catch (error) {
      console.error("Error validating answers:", error);
      // Send a fallback message
      this.party.broadcast(JSON.stringify({
        type: "error",
        message: "Error validating answers"
      }));
    }
  }
} 