const axios = require('axios');

// Get API key and Assistant ID from environment variables
const API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

/**
 * Creates a thread with the OpenAI Assistant
 * @returns {Promise<string>} The thread ID
 */
async function createThread() {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/threads',
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      }
    );
    return response.data.id;
  } catch (error) {
    console.error('Error creating thread:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Sends a message to the assistant and gets the response
 * @param {string} threadId The thread ID
 * @param {string} content The message content
 * @returns {Promise<string>} The run ID
 */
async function sendMessage(threadId, content) {
  try {
    const response = await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        role: 'user',
        content
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      }
    );
    return response.data.id;
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Runs the assistant on a thread
 * @param {string} threadId The thread ID
 * @returns {Promise<string>} The run ID
 */
async function runAssistant(threadId) {
  try {
    const response = await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/runs`,
      {
        assistant_id: ASSISTANT_ID
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      }
    );
    return response.data.id;
  } catch (error) {
    console.error('Error running assistant:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets the status of a run
 * @param {string} threadId The thread ID
 * @param {string} runId The run ID
 * @returns {Promise<string>} The run status
 */
async function getRunStatus(threadId, runId) {
  try {
    const response = await axios.get(
      `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      }
    );
    return response.data.status;
  } catch (error) {
    console.error('Error getting run status:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Gets the messages in a thread
 * @param {string} threadId The thread ID
 * @returns {Promise<Array>} The messages
 */
async function getMessages(threadId) {
  try {
    const response = await axios.get(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      }
    );
    return response.data.data;
  } catch (error) {
    console.error('Error getting messages:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Waits for a run to complete
 * @param {string} threadId The thread ID
 * @param {string} runId The run ID
 * @returns {Promise<void>}
 */
async function waitForRunCompletion(threadId, runId) {
  const maxAttempts = 30;
  const delayMs = 1000;
  
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getRunStatus(threadId, runId);
    
    if (status === 'completed') {
      return;
    } else if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      throw new Error(`Run ${runId} ended with status: ${status}`);
    }
    
    // Wait before checking again
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  
  throw new Error(`Run ${runId} did not complete within the expected time`);
}

/**
 * Validates a player's answers using the OpenAI Assistant
 * @param {string} letter The current round letter
 * @param {Object} answers The player's answers for each category
 * @returns {Promise<Object>} Validation results
 */
async function validateAnswers(letter, answers) {
  if (!API_KEY || !ASSISTANT_ID) {
    console.warn('OpenAI API Key or Assistant ID not set. Skipping validation.');
    return { valid: true, errors: [], suggestions: {} };
  }

  try {
    // Create validation prompt
    const validationPrompt = JSON.stringify({
      task: "Validate user-submitted answers for the game 'Stadt, Land, Fluss'.",
      rules: {
        general: "Each answer must start with the specified letter and fit the category. Be VERY strict with validation.",
        categories: {
          Stadt: "Must be a real, existing city or town with official city rights. Include a brief description of the city.",
          Land: "Must be a recognized sovereign country, federal state, or well-known historical region. Include a brief description.",
          Fluss: "Must be a real, existing river. Streams, creeks, lakes, or fictional rivers are invalid. Include a brief description.",
          Name: "Must be a common first name used for people. Nicknames are valid only if widely recognized. Include origin information if possible.",
          Beruf: "Must be a recognized official profession or occupation. Obsolete, fictional, or made-up jobs are invalid. Include a brief description.",
          Pflanze: "Must be a specific plant species, including trees, flowers, or crops. Generic terms are invalid. Include a brief description.",
          Tier: "Must be a specific animal species, using either scientific or common name. Include a brief description."
        }
      },
      letter,
      answers,
      output_format: {
        valid: "Boolean indicating if ALL answers are valid",
        errors: "Array of strings describing validation errors for specific answers",
        suggestions: "Object with category keys and string values containing alternate suggestions that start with the required letter",
        explanations: "Object with category keys and string values containing brief explanations for each valid answer"
      },
      important_instruction: "IMPORTANT: Be VERY strict in your validation. The answers MUST start with the letter provided. If they don't, they are invalid. Generic terms, made-up words, or incorrect category matches are invalid. For valid answers, provide a brief explanation or description (1-2 sentences). For invalid answers, suggest valid alternatives that start with the required letter."
    });

    console.log(`Sending validation request for letter ${letter} with answers:`, answers);

    // Create a new thread
    const threadId = await createThread();

    // Send a message to the thread
    await sendMessage(threadId, validationPrompt);

    // Run the assistant on the thread
    const runId = await runAssistant(threadId);

    // Wait for the run to complete
    await waitForRunCompletion(threadId, runId);

    // Get the messages from the thread
    const messages = await getMessages(threadId);

    // Get the assistant's response (first message)
    const assistantResponse = messages.find(msg => msg.role === 'assistant');
    
    if (!assistantResponse) {
      console.error('No assistant response found');
      throw new Error('No assistant response found');
    }

    let content = '';
    if (assistantResponse.content && assistantResponse.content.length > 0) {
      content = assistantResponse.content[0].text?.value || '';
    }

    console.log('Raw validation response:', content);

    try {
      // Remove any comments from the JSON string before parsing
      const cleanedJson = content.replace(/\/\/.*$/gm, '').trim();
      // Try to parse the response as JSON
      const parsedResponse = JSON.parse(cleanedJson);
      console.log('Parsed validation result:', parsedResponse);
      return parsedResponse;
    } catch (e) {
      console.error('Failed to parse assistant response as JSON:', content);
      console.error('Parse error:', e);
      
      // More robust text extraction
      const responseProcessing = {};
      
      // Check each category against the letter
      const categories = Object.keys(answers);
      const errors = [];
      let allValid = true;
      
      categories.forEach(category => {
        const answer = answers[category];
        if (!answer) return;
        
        // Check if answer starts with the correct letter (case insensitive)
        if (!answer.toLowerCase().startsWith(letter.toLowerCase())) {
          errors.push(`${category}: "${answer}" does not start with the letter "${letter}"`);
          allValid = false;
        }
        
        // Look for category-specific validation issues in the text
        if (content.toLowerCase().includes(`${category.toLowerCase()}`) && 
            content.toLowerCase().includes(`${answer.toLowerCase()}`) && 
            (content.toLowerCase().includes('invalid') || 
             content.toLowerCase().includes('error') || 
             content.toLowerCase().includes('not valid'))) {
          
          // Find specific error message for this category
          const lines = content.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes(category.toLowerCase()) && 
                (line.toLowerCase().includes('invalid') || 
                 line.toLowerCase().includes('error') || 
                 line.toLowerCase().includes('not valid'))) {
              
              errors.push(`${category}: ${line.trim()}`);
              allValid = false;
              break;
            }
          }
        }
      });
      
      // Create suggestions object
      const suggestions = {};
      categories.forEach(category => {
        const lines = content.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes(category.toLowerCase()) && 
              line.toLowerCase().includes('suggest')) {
            const suggestionMatch = line.match(/suggest\w*\s+['""]?([^'""]+)['""]?/i);
            if (suggestionMatch && suggestionMatch[1]) {
              suggestions[category] = suggestionMatch[1].trim();
            }
          }
        }
      });
      
      // If parsing fails, return a structured response
      const result = {
        valid: allValid,
        errors,
        suggestions
      };
      
      console.log('Extracted validation result from text:', result);
      return result;
    }
  } catch (error) {
    console.error('Error validating answers with OpenAI Assistant:', error);
    
    // Fallback validation if API fails
    const errors = [];
    let allValid = true;
    
    // Basic validation: check if answers start with the correct letter
    Object.entries(answers).forEach(([category, answer]) => {
      if (answer && !answer.toLowerCase().startsWith(letter.toLowerCase())) {
        errors.push(`${category}: "${answer}" does not start with the letter "${letter}"`);
        allValid = false;
      }
    });
    
    const result = {
      valid: allValid,
      errors,
      suggestions: {}
    };
    
    console.log('Fallback validation result:', result);
    return result;
  }
}

module.exports = { validateAnswers }; 