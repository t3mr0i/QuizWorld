require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const { validateAnswers } = require('./chatgpt-validator');

// Check for required environment variables
if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
  console.warn('\x1b[33m%s\x1b[0m', 'Warning: OPENAI_API_KEY or OPENAI_ASSISTANT_ID environment variables are not set.');
  console.warn('\x1b[33m%s\x1b[0m', 'The game will run, but answer validation will be limited to basic checks.');
  console.warn('\x1b[33m%s\x1b[0m', 'Create a .env file based on the .env.example file to enable full validation.');
}

// PartyKit host configuration (fallback to localhost for development)
const PARTYKIT_HOST = process.env.PARTYKIT_HOST || 'stadt-land-fluss.t3mr0i.partykit.dev';
console.log(`Using PartyKit host: ${PARTYKIT_HOST}`);

// Game constants
const CATEGORIES = ['Stadt', 'Land', 'Fluss', 'Name', 'Beruf', 'Pflanze', 'Tier'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Game state
const rooms = {};

const app = express();
app.use(cors());

// Middleware to inject PartyKit host into HTML files
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(body) {
    if (typeof body === 'string' && (req.path === '/' || req.path.endsWith('.html'))) {
      body = body.replace(/__PARTYKIT_HOST__/g, PARTYKIT_HOST);
    }
    return originalSend.call(this, body);
  };
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// Special handling for static files - modify HTML files before serving
app.get('*.html', (req, res, next) => {
  try {
    const filePath = path.join(__dirname, '../public', req.path);
    let html = fs.readFileSync(filePath, 'utf8');
    html = html.replace(/__PARTYKIT_HOST__/g, PARTYKIT_HOST);
    res.send(html);
  } catch (error) {
    next(); // Continue to static middleware if file not found
  }
});

// Route to serve the main index.html file
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  html = html.replace(/__PARTYKIT_HOST__/g, PARTYKIT_HOST);
  res.send(html);
});

const server = http.createServer(app);
const io = new Server(server);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Create or join a game room
  socket.on('joinRoom', ({ roomId, playerName, timeLimit }) => {
    console.log(`${playerName} (${socket.id}) is joining room ${roomId}`);
    
    // Initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: {},
        currentLetter: null,
        roundInProgress: false,
        roundResults: {},
        admin: socket.id,
        timeLimit: timeLimit || 60, // Default to 60 seconds if not specified
        timerEnd: null
      };
      console.log(`Created new room ${roomId} with admin ${socket.id}`);
    }
    
    // Add player to room
    socket.join(roomId);
    rooms[roomId].players[socket.id] = {
      id: socket.id,
      name: playerName,
      answers: {},
      score: 0,
      isReady: false,
      isAdmin: rooms[roomId].admin === socket.id
    };
    
    // Log current players in the room for debugging
    console.log(`Room ${roomId} now has ${Object.keys(rooms[roomId].players).length} players:`);
    Object.values(rooms[roomId].players).forEach(p => {
      console.log(`- ${p.name} (${p.id})${p.isAdmin ? ' (Admin)' : ''}`);
    });
    
    // Notify everyone in the room
    io.to(roomId).emit('playerJoined', {
      players: Object.values(rooms[roomId].players),
      admin: rooms[roomId].admin,
      timeLimit: rooms[roomId].timeLimit
    });
    
    // Store room ID in socket for easy access
    socket.roomId = roomId;
  });

  // Start a new round
  socket.on('startRound', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    // Only admin can start the round
    if (rooms[roomId].admin !== socket.id) return;
    
    console.log(`Admin ${socket.id} started new round in room ${roomId}`);
    
    // Select a random letter
    const randomIndex = Math.floor(Math.random() * LETTERS.length);
    const letter = LETTERS[randomIndex];
    
    // Set round timer
    const timeLimit = rooms[roomId].timeLimit;
    const timerEnd = new Date(Date.now() + timeLimit * 1000);
    
    // Update room state
    rooms[roomId].currentLetter = letter;
    rooms[roomId].roundInProgress = true;
    rooms[roomId].roundResults = {};
    rooms[roomId].timerEnd = timerEnd;
    
    // Reset player answers and readiness
    Object.keys(rooms[roomId].players).forEach(playerId => {
      rooms[roomId].players[playerId].answers = {};
      rooms[roomId].players[playerId].isReady = false;
      // Ensure isAdmin property is correctly set
      rooms[roomId].players[playerId].isAdmin = (playerId === rooms[roomId].admin);
    });
    
    // Log current players before starting the round
    console.log(`Starting round with ${Object.keys(rooms[roomId].players).length} players:`);
    Object.values(rooms[roomId].players).forEach(p => {
      console.log(`- ${p.name} (${p.id})${p.isAdmin ? ' (Admin)' : ''}`);
    });
    
    // Notify everyone in the room that a new round started
    io.to(roomId).emit('roundStarted', { 
      letter,
      timeLimit,
      players: Object.values(rooms[roomId].players)
    });
    
    // Set a server-side timer to end the round automatically
    setTimeout(() => {
      const room = rooms[roomId];
      if (room && room.roundInProgress) {
        console.log(`Time's up for room ${roomId}`);
        processRoundEnd(roomId);
      }
    }, timeLimit * 1000);
  });

  // Submit answers for a round
  socket.on('submitAnswers', (answers) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId] || !rooms[roomId].roundInProgress) return;
    
    console.log(`Player ${socket.id} submitted answers in room ${roomId}`);
    
    // Store player answers
    rooms[roomId].players[socket.id].answers = answers;
    rooms[roomId].players[socket.id].isReady = true;
    
    // Check if all players are ready
    const allReady = Object.values(rooms[roomId].players).every(player => player.isReady);
    
    // Update isAdmin property for all players to ensure consistency
    Object.keys(rooms[roomId].players).forEach(playerId => {
      rooms[roomId].players[playerId].isAdmin = (playerId === rooms[roomId].admin);
    });
    
    if (allReady) {
      // Process round results
      processRoundEnd(roomId);
    } else {
      // Notify others that this player is ready
      io.to(roomId).emit('playerReady', {
        playerId: socket.id,
        players: Object.values(rooms[roomId].players)
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    
    if (roomId && rooms[roomId]) {
      console.log(`Player ${socket.id} disconnected from room ${roomId}`);
      
      // Get player name before removing
      const playerName = rooms[roomId].players[socket.id]?.name || 'Unknown';
      
      // Remove player from room
      delete rooms[roomId].players[socket.id];
      
      // If room is empty, delete it
      if (Object.keys(rooms[roomId].players).length === 0) {
        console.log(`Room ${roomId} is empty, deleting room`);
        delete rooms[roomId];
      } 
      // If admin left, assign a new admin
      else if (rooms[roomId].admin === socket.id) {
        const newAdminId = Object.keys(rooms[roomId].players)[0];
        rooms[roomId].admin = newAdminId;
        rooms[roomId].players[newAdminId].isAdmin = true;
        
        console.log(`Admin left, new admin is ${newAdminId}`);
        
        // Notify remaining players about new admin
        io.to(roomId).emit('newAdmin', { admin: rooms[roomId].admin });
      }
      
      // Log current players in the room after disconnect
      console.log(`After disconnect, room ${roomId} has ${Object.keys(rooms[roomId].players).length} players:`);
      Object.values(rooms[roomId].players).forEach(p => {
        console.log(`- ${p.name} (${p.id})${p.isAdmin ? ' (Admin)' : ''}`);
      });
      
      // Notify remaining players
      io.to(roomId).emit('playerLeft', {
        playerId: socket.id,
        playerName: playerName,
        players: Object.values(rooms[roomId].players)
      });
    }
  });
});

// Function to process the end of a round (either by time limit or all players submitted)
function processRoundEnd(roomId) {
  const room = rooms[roomId];
  if (!room || !room.roundInProgress) return;
  
  // Mark round as no longer in progress to prevent duplicate processing
  room.roundInProgress = false;
  
  // Validate and score the round
  validateAndScoreRound(roomId);
}

// Function to validate and score a round
async function validateAndScoreRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  // Mark round as finished
  room.roundInProgress = false;
  
  // Get the current letter
  const letter = room.currentLetter;
  
  // Ensure all players have the correct isAdmin property
  Object.keys(room.players).forEach(playerId => {
    room.players[playerId].isAdmin = (playerId === room.admin);
  });
  
  // Collect all answers for validation
  const playerValidations = [];
  const playerIds = Object.keys(room.players);
  
  console.log(`Starting validation for room ${roomId} with letter ${letter}`);
  
  // Validate each player's answers with OpenAI Assistant
  for (const playerId of playerIds) {
    const player = room.players[playerId];
    console.log(`Validating answers for player ${player.name}:`, player.answers);
    
    // Use the OpenAI assistant validator
    const validationResult = await validateAnswers(letter, player.answers);
    console.log(`Validation result for ${player.name}:`, validationResult);
    
    playerValidations.push({
      playerId,
      validation: validationResult
    });
  }
  
  // Process scores based on validation and uniqueness
  const scoresByCategory = {};
  CATEGORIES.forEach(category => {
    scoresByCategory[category] = {};
    
    // Count occurrences of each answer
    const answerCount = {};
    Object.values(room.players).forEach(player => {
      const answer = player.answers[category];
      if (answer && answer.trim()) {
        answerCount[answer.toLowerCase()] = (answerCount[answer.toLowerCase()] || 0) + 1;
      }
    });
    
    // Collect all suggestions for each category across validations
    const categorySuggestions = {};
    playerValidations.forEach(({validation}) => {
      if (validation.suggestions && validation.suggestions[category]) {
        categorySuggestions[category] = validation.suggestions[category];
      }
    });
    
    // Collect all explanations for each category across validations
    const categoryExplanations = {};
    playerValidations.forEach(({validation}) => {
      if (validation.explanations && validation.explanations[category]) {
        categoryExplanations[category] = validation.explanations[category];
      }
    });
    
    // Assign scores based on validation and uniqueness
    for (const {playerId, validation} of playerValidations) {
      const player = room.players[playerId];
      const answer = player.answers[category];
      
      if (answer && answer.trim()) {
        const lowerAnswer = answer.toLowerCase();
        
        // Determine if the answer is valid based on OpenAI validation
        let isValid = false;
        let categoryErrors = [];
        
        // Check if the answer is valid according to the AI
        if (validation.valid === true) {
          // If the entire validation is valid with no errors
          isValid = true;
        } else if (validation.errors && Array.isArray(validation.errors)) {
          // Look for category-specific errors
          categoryErrors = validation.errors.filter(error => 
            error.toLowerCase().includes(category.toLowerCase())
          );
          // If there are no category-specific errors, the answer is valid
          isValid = categoryErrors.length === 0;
        }
        
        // Score: 
        // - 20 points if valid and unique
        // - 10 points if valid but not unique
        // - 0 points if invalid
        const score = isValid 
          ? (answerCount[lowerAnswer] === 1 ? 20 : 10) 
          : 0;
        
        console.log(`Scoring ${category} for ${player.name}: Answer "${answer}" is ${isValid ? 'valid' : 'invalid'} and ${answerCount[lowerAnswer] === 1 ? 'unique' : 'not unique'} = ${score} points`);
        
        // Get explanation if available
        let explanation = null;
        if (validation.explanations && validation.explanations[category]) {
          explanation = validation.explanations[category];
        } else if (categoryExplanations[category]) {
          explanation = categoryExplanations[category];
        }
        
        // Get suggestions
        let suggestions = null;
        if (validation.suggestions && validation.suggestions[category]) {
          suggestions = validation.suggestions[category];
        } else if (categorySuggestions[category]) {
          suggestions = categorySuggestions[category];
        }
        
        scoresByCategory[category][playerId] = {
          answer,
          unique: answerCount[lowerAnswer] === 1,
          valid: isValid,
          score,
          errors: categoryErrors,
          suggestions: suggestions,
          explanation: explanation
        };
      } else {
        scoresByCategory[category][playerId] = {
          answer: '',
          unique: false,
          valid: false,
          score: 0,
          errors: [],
          suggestions: validation.suggestions && validation.suggestions[category] 
            ? validation.suggestions[category] 
            : (categorySuggestions[category] || null),
          explanation: null
        };
      }
    }
  });
  
  // Calculate total scores for this round and update player scores
  Object.values(room.players).forEach(player => {
    let roundScore = 0;
    CATEGORIES.forEach(category => {
      if (scoresByCategory[category][player.id]) {
        roundScore += scoresByCategory[category][player.id].score;
      }
    });
    
    // Update total score
    player.score += roundScore;
    console.log(`Total score for ${player.name} this round: ${roundScore}`);
  });
  
  // Store round results
  room.roundResults = scoresByCategory;
  
  // At the end, before sending results, log admin status
  console.log("Admin status before sending results:");
  Object.values(room.players).forEach(player => {
    console.log(`- ${player.name} (${player.id}): ${player.isAdmin ? 'Admin' : 'Not Admin'}`);
  });
  
  // Send results to all players
  io.to(roomId).emit('roundResults', {
    scores: scoresByCategory,
    players: Object.values(room.players)
  });
}

const startServer = (port) => {
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is busy, trying port ${port + 1}...`);
      setTimeout(() => {
        server.close();
        startServer(port + 1);
      }, 1000);
    } else {
      console.error('Server error:', error);
    }
  });

  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
};

const PORT = process.env.PORT || 5678;
startServer(PORT); 