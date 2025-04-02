# Stadt Land Fluss - Server Setup Guide

## Server Configuration for Answer Validation

The Stadt Land Fluss game uses OpenAI's API to validate answers. If you're seeing "Error validating answers" messages, follow this setup guide to fix the issue.

## Prerequisites

- An OpenAI API key (get one at https://platform.openai.com/api-keys)
- Access to the server where the game is hosted

## Configuration Steps

1. **Create a `.env` file in the server directory**

   In the root directory of your game installation, create a new file named `.env` with the following content:

   ```
   OPENAI_API_KEY=your_api_key_here
   OPENAI_ASSISTANT_ID=your_assistant_id_here
   ```

2. **Get your OpenAI API Key**

   - Log in to https://platform.openai.com/
   - Go to API Keys
   - Create a new secret key
   - Copy the key and replace `your_api_key_here` in the `.env` file

   **Note on Project API Keys (sk-proj-...):**  
   If your API key starts with `sk-proj-`, you're using a project-style API key with the OpenAI platform. These keys may have different permission requirements:
   
   - Make sure the project has access to the Assistants API
   - Check that the key has permission to access the required models
   - You may need to add your Organization ID if you're part of multiple organizations:
     ```
     OPENAI_API_KEY=sk-proj-your-key-here
     OPENAI_ORG_ID=org-your-org-id-here
     OPENAI_ASSISTANT_ID=asst-your-assistant-id-here
     ```

3. **Create an OpenAI Assistant**

   - Go to https://platform.openai.com/assistants
   - Click "Create new assistant"
   - Name it "Stadt Land Fluss Validator"
   - Select the GPT-4 or GPT-3.5 model
   - Add the following instructions:
     ```
     You are an answer validator for the "Stadt Land Fluss" (City Country River) German word game.
     
     Your job is to validate answers according to these rules:
     1. Answers must start with the specified letter
     2. Answers must be real, existing things in their category
     3. Answers must be correctly spelled
     4. Categories include Stadt (City), Land (Country), Fluss (River), Name, Beruf (Profession), Tier (Animal), and Pflanze (Plant)
     
     For each answer, you will determine if it's valid and explain why.
     Invalid answers should have clear explanations of why they're incorrect.
     You should suggest valid alternatives when possible.
     ```
   - Copy the Assistant ID (found in the URL or in the assistant's details)
   - Replace `your_assistant_id_here` in the `.env` file

4. **Restart the server**

   - Save the `.env` file
   - Restart your game server to apply the changes

## Troubleshooting

If you're still seeing validation errors after following these steps, check the following:

1. **API Key Issues**
   - Make sure your OpenAI API key has available credits
   - Check that you've copied the key correctly without any extra spaces
   - For project API keys (starting with `sk-proj-`), ensure the project has access to the Assistants API

2. **API Endpoint Issues**
   - The server logs should indicate if there's an endpoint mismatch
   - Project API keys may require specific API endpoint configurations

3. **Assistant Issues**
   - Verify that your assistant is set up correctly with the GPT-4 or GPT-3.5 model
   - Make sure you've copied the Assistant ID correctly

4. **Server Logs**
   - Check the server logs for any OpenAI API errors
   - Common errors include rate limiting, authentication failures, or invalid API keys
   - Look for detailed error codes and messages in the logs

5. **Manual Testing**
   - You can test your API key with a simple cURL command:
     ```
     curl https://api.openai.com/v1/models \
       -H "Authorization: Bearer YOUR_API_KEY"
     ```
   - A successful response will list available models

## Server Location Issues

Sometimes, the `.env` file might be in the wrong location. The server looks for it in these locations:

1. The root directory of the game installation
2. The `server` directory 
3. The parent directory of the `server` directory

Make sure to place the `.env` file in the root directory for best compatibility.

## Need Help?

If you continue to experience issues, check the OpenAI documentation or contact the game developer for assistance. 