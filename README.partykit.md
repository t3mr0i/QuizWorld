# Stadt, Land, Fluss - PartyKit Version

This is a PartyKit-powered version of Stadt, Land, Fluss, a multiplayer word game based on the classic German game.

## Why PartyKit?

PartyKit is a powerful platform for building multiplayer applications that run on Cloudflare's global network. It provides:

- Better support for WebSockets than Vercel
- Built-in persistence with PartyKit storage
- Global distribution via Cloudflare's network
- Zero configuration deployment

## Running Locally

To run the game locally with PartyKit:

```bash
# Install dependencies if you haven't already
npm install

# Start the PartyKit server
npm run serve
```

Open your browser to http://localhost:1999 to use the application.

## Deploying to PartyKit

To deploy the game to PartyKit's global network:

```bash
npm run partykit:deploy
```

Once deployed, you'll receive a URL where your game is hosted on PartyKit's infrastructure.

## How it Works

The game uses PartyKit for:

1. **WebSocket Communication** - All game messages are sent via WebSockets
2. **State Management** - Game state is stored in PartyKit's persistent storage
3. **Static File Serving** - The game's frontend is served directly by PartyKit
4. **Answer Validation** - The game still uses the OpenAI Assistant for validation

## Environment Variables

Make sure to set these environment variables for the game to work properly:

```
OPENAI_API_KEY=your_api_key_here
OPENAI_ASSISTANT_ID=your_assistant_id_here
```

## Migrating from Socket.IO

This version uses a custom adapter (`public/js/partysocket.js`) that mimics the Socket.IO API but uses PartyKit's WebSocket connection underneath. This allows the game to work with minimal changes to the frontend code.

## Troubleshooting

If you encounter any issues with the PartyKit connection:

1. Check your browser console for error messages
2. Ensure your PartyKit server is running (for local development)
3. Verify that your environment variables are properly set
4. Try a different browser or clear your cache

For more assistance, visit the [PartyKit documentation](https://docs.partykit.io/). 