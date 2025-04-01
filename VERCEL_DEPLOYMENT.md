# Vercel Deployment Guide for Stadt Land Fluss with PartyKit

This guide explains how to deploy the Stadt Land Fluss game to Vercel while using PartyKit for real-time multiplayer functionality.

## Prerequisites

- A [Vercel](https://vercel.com) account
- A [PartyKit](https://partykit.io) account
- Git repository for your project
- OpenAI API key and Assistant ID

## Step 1: Deploy the PartyKit Server

1. Ensure you have the PartyKit CLI installed:
   ```bash
   npm install -g partykit
   ```

2. Log in to PartyKit:
   ```bash
   npx partykit login
   ```

3. Deploy your PartyKit server:
   ```bash
   npx partykit deploy
   ```

4. Note the PartyKit domain that's assigned to your project (e.g., `your-project.partykit.dev`)

## Step 2: Set Up Vercel Project

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)

2. Connect your repository to Vercel:
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "Add New" → "Project"
   - Select your repository
   - Configure the project with the following settings:
     - Build Command: `npm run build` (or leave as default)
     - Output Directory: `public` (should be automatically detected)
     - Install Command: `npm install`

3. Add Environment Variables in the Vercel project settings:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `OPENAI_ASSISTANT_ID`: Your OpenAI Assistant ID
   - `PARTYKIT_HOST`: Your PartyKit domain (e.g., `your-project.partykit.dev`)

4. Deploy the project by clicking "Deploy"

## Step 3: Test and Verify

1. Once deployment is complete, Vercel will provide a URL for your application (e.g., `your-project.vercel.app`)

2. Visit the URL to verify that:
   - The game loads correctly
   - You can create a game room
   - The connection to PartyKit is established
   - Real-time multiplayer functionality works

3. Check the browser console for any connection errors

## Troubleshooting

If you encounter issues with the PartyKit connection:

1. Verify the `PARTYKIT_HOST` environment variable is correctly set in Vercel

2. Check browser console logs for any WebSocket connection errors

3. Make sure your PartyKit deployment is active by visiting its URL directly

4. Try manually connecting to the WebSocket endpoint for debugging:
   ```javascript
   const socket = new WebSocket(`wss://your-project.partykit.dev/party/game`);
   socket.onopen = () => console.log('Connected');
   socket.onmessage = (event) => console.log(event.data);
   socket.onerror = (error) => console.error('Error:', error);
   ```

## Updating Your Deployment

When you make changes to your code:

1. Push the changes to your Git repository

2. Vercel will automatically redeploy the application

3. If you made changes to the PartyKit server, redeploy it:
   ```bash
   npx partykit deploy
   ```

## PartyKit Configuration Notes

- The `PARTYKIT_HOST` environment variable is used to configure the WebSocket connection in the client
- The default PartyKit server port for local development is 1999
- In production, your PartyKit server is accessible at `your-project.partykit.dev` 