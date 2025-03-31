# Stadt, Land, Fluss

A multiplayer word game based on the classic German game "Stadt, Land, Fluss" (City, Country, River).

![Game Demo](https://i.imgur.com/YWvLKoT.png)

## Game Rules

- Players are given a random letter at the beginning of each round
- Each player must come up with words that start with that letter for each category (City, Country, River, Name, Profession, Plant, Animal)
- Players submit their answers and receive points based on uniqueness and validity:
  - 20 points for valid unique answers
  - 10 points for valid non-unique answers
  - 0 points for invalid answers
- After all players submit, validation is performed and scores are calculated
- The player with the highest total score at the end wins

## Features

- Real-time multiplayer using Socket.IO
- Answer validation using OpenAI Assistants API
- Unique room system for private games with friends
- Score tracking and round management
- Clean, responsive design

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/stadtlandfluss.git
cd stadtlandfluss
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory with:
```
OPENAI_API_KEY=your_api_key_here
OPENAI_ASSISTANT_ID=your_assistant_id_here
```

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to `http://localhost:5678` (or the port shown in the console if 5678 is busy)

3. Create a game room or join an existing one

4. Share the room ID with friends to play together

5. Start the game when everyone is ready

### Port Issues

If you encounter port conflicts (EADDRINUSE errors), you can run:
```bash
npm run kill-ports
```
This will find and terminate processes using the game's ports (3000, 5678, etc.).

## OpenAI Assistant Integration

This game uses the OpenAI Assistants API v2 for answer validation. The assistant evaluates:
- If answers start with the designated letter
- If answers are valid for their respective categories
- If answers are unique among players

The validation uses a pre-configured assistant that's specialized for the "Stadt, Land, Fluss" game rules.

### Setting up the Assistant

1. Create an OpenAI account and get an API key from [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new Assistant in the OpenAI platform using the v2 API
3. Configure the assistant with the "Stadt, Land, Fluss" validation instructions
4. Copy the Assistant ID and API key to your `.env` file

## Development

To run in development mode with auto-restart:
```bash
npm run dev
```

## Technologies Used

- Node.js and Express for the backend
- Socket.IO for real-time communication
- OpenAI Assistants API for answer validation
- HTML, CSS, and JavaScript for the frontend

## License

This project is licensed under the ISC License. 