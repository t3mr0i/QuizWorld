const axios = require('axios');

// Get API key and Assistant ID from environment variables
const API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

// Check if we're using a project-style API key
const isProjectKey = API_KEY && API_KEY.startsWith('sk-proj-');

// Only log essential security information, never expose keys
console.log('=== OPENAI API SECURITY CHECK ===');
console.log('API_KEY configured:', !!API_KEY);
console.log('API_KEY format valid:', API_KEY ? API_KEY.startsWith('sk-') : false);
console.log('ASSISTANT_ID configured:', !!ASSISTANT_ID);
console.log('Using project-style key:', isProjectKey);
console.log('=== END SECURITY CHECK ===');

// Add a test function to verify API key is working
async function testApiKey() {
  if (!API_KEY) {
    console.error('❌ Cannot test API key - it is not set');
    return false;
  }
  
  console.log('🔍 Testing OpenAI API key...');
  try {
    // Try a simple API call that doesn't cost much
    const response = await axios.get(
      'https://api.openai.com/v1/models',
      {
        headers: getApiHeaders()
      }
    );
    
    if (response.status === 200) {
      console.log('✅ API key is valid! Received models list successfully.');
      
      // If testing a project-style key, log some extra info
      if (isProjectKey) {
        console.log('📊 Project API key details:');
        console.log('- Available models:', response.data.data.length);
        console.log('- First few models:', response.data.data.slice(0, 3).map(m => m.id).join(', '));
      }
      
      return true;
    } else {
      console.error('❌ Unexpected response when testing API key:', response.status);
      return false;
    }
  } catch (error) {
    console.error('❌ API key test failed:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Error details:', error.response.data);
      
      // Provide specific guidance based on error code
      if (error.response.status === 401) {
        console.error('❌ API key is invalid or has been revoked');
        if (isProjectKey) {
          console.error('❌ Project API keys may have specific permission requirements');
        }
      } else if (error.response.status === 429) {
        console.error('❌ Rate limit exceeded. Your API key is valid but you are sending too many requests');
      } else if (error.response.status === 404) {
        console.error('❌ API endpoint not found. This could indicate an API version mismatch');
      }
    } else {
      console.error('Connection error:', error.message);
    }
    return false;
  }
}

// Standard headers for OpenAI API requests
function getApiHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
    'OpenAI-Beta': 'assistants=v2'
  };
  
  // Add any special headers for project keys if needed
  if (isProjectKey) {
    console.log('Using project-style API key configuration');
    // Some project keys may need additional headers or configurations
    // headers['OpenAI-Organization'] = process.env.OPENAI_ORG_ID;
  }
  
  return headers;
}

/**
 * Creates a thread with the OpenAI Assistant
 * @returns {Promise<string>} The thread ID
 */
async function createThread() {
  return makeValidatorRequest(async () => {
    console.log('🔗 Creating a new thread with OpenAI...');
    
    const startTime = Date.now();
    const response = await axios.post(
      'https://api.openai.com/v1/threads',
      {},
      {
        headers: getApiHeaders(),
        timeout: 30000
      }
    );
    const endTime = Date.now();
    
    console.log(`🔗 Thread creation successful in ${endTime - startTime}ms. Thread ID: ${response.data.id}`);
    return response.data.id;
  }, 'Create Thread');
}

/**
 * Sends a message to the assistant and gets the response
 * @param {string} threadId The thread ID
 * @param {string} content The message content
 * @returns {Promise<string>} The run ID
 */
async function sendMessage(threadId, content) {
  return makeValidatorRequest(async () => {
    const response = await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        role: 'user',
        content
      },
      {
        headers: getApiHeaders(),
        timeout: 30000
      }
    );
    return response.data.id;
  }, 'Send Message');
}

/**
 * Runs the assistant on a thread
 * @param {string} threadId The thread ID
 * @returns {Promise<string>} The run ID
 */
async function runAssistant(threadId) {
  return makeValidatorRequest(async () => {
    const response = await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/runs`,
      {
        assistant_id: ASSISTANT_ID
      },
      {
        headers: getApiHeaders(),
        timeout: 30000
      }
    );
    return response.data.id;
  }, 'Run Assistant');
}

/**
 * Gets the status of a run
 * @param {string} threadId The thread ID
 * @param {string} runId The run ID
 * @returns {Promise<string>} The run status
 */
async function getRunStatus(threadId, runId) {
  return makeValidatorRequest(async () => {
    const response = await axios.get(
      `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
      {
        headers: getApiHeaders(),
        timeout: 30000
      }
    );
    return response.data.status;
  }, 'Get Run Status');
}

/**
 * Gets the messages in a thread
 * @param {string} threadId The thread ID
 * @returns {Promise<Array>} The messages
 */
async function getMessages(threadId) {
  return makeValidatorRequest(async () => {
    const response = await axios.get(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        headers: getApiHeaders(),
        timeout: 30000
      }
    );
    return response.data.data;
  }, 'Get Messages');
}

/**
 * Deletes a thread to free up resources
 * @param {string} threadId The thread ID
 * @returns {Promise<void>}
 */
async function deleteThread(threadId) {
  try {
    console.log(`🗑️ Deleting thread: ${threadId}`);
    await axios.delete(
      `https://api.openai.com/v1/threads/${threadId}`,
      {
        headers: getApiHeaders()
      }
    );
    console.log(`✅ Thread ${threadId} deleted successfully`);
  } catch (error) {
    console.error(`❌ Error deleting thread ${threadId}:`, error.response?.data || error.message);
    // Don't throw error for cleanup operations
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

// Add retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  backoffMultiplier: 2
};

// Utility function for delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate exponential backoff with jitter
function calculateBackoffDelay(attempt) {
  const delay = Math.min(
    RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
    RETRY_CONFIG.maxDelayMs
  );
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
}

// Enhanced error parsing for better categorization
function parseValidatorError(error) {
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;
    
    switch (status) {
      case 401:
        return {
          code: 'AUTH_ERROR',
          message: 'Invalid API key or unauthorized access',
          retryable: false,
          suggestion: 'Check your API key configuration'
        };
      case 429:
        return {
          code: 'RATE_LIMIT',
          message: 'API rate limit exceeded',
          retryable: true,
          suggestion: 'Wait before retrying - consider upgrading your plan'
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          code: 'SERVER_ERROR',
          message: `OpenAI server error: ${status}`,
          retryable: true,
          suggestion: 'OpenAI service is experiencing issues'
        };
      case 408:
        return {
          code: 'TIMEOUT',
          message: 'Request timeout',
          retryable: true,
          suggestion: 'Request took too long - will retry'
        };
      default:
        return {
          code: 'API_ERROR',
          message: data?.error?.message || `HTTP ${status}`,
          retryable: status >= 500,
          suggestion: 'Check request format and permissions'
        };
    }
  }
  
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return {
      code: 'NETWORK_ERROR',
      message: 'Network connection failed',
      retryable: true,
      suggestion: 'Check internet connection'
    };
  }
  
  return {
    code: 'UNKNOWN_ERROR',
    message: error.message || 'Unknown error occurred',
    retryable: true,
    suggestion: 'Unexpected error - will retry'
  };
}

// Enhanced request wrapper with timeout and retry logic
async function makeValidatorRequest(operation, operationName) {
  let lastError = null;
  
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`🔄 ${operationName} - Attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}`);
      
      // Add timeout to operation
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Operation timeout')), 30000);
      });
      
      const result = await Promise.race([operation(), timeoutPromise]);
      console.log(`✅ ${operationName} succeeded on attempt ${attempt + 1}`);
      return result;
      
    } catch (error) {
      lastError = parseValidatorError(error);
      
      console.warn(`⚠️ ${operationName} failed (attempt ${attempt + 1}):`, {
        code: lastError.code,
        message: lastError.message,
        suggestion: lastError.suggestion
      });
      
      // Don't retry if error is not retryable or we're on the last attempt
      if (!lastError.retryable || attempt === RETRY_CONFIG.maxRetries) {
        break;
      }
      
      // Calculate and apply backoff delay
      const delayMs = calculateBackoffDelay(attempt);
      console.log(`⏳ Waiting ${delayMs}ms before retry...`);
      await delay(delayMs);
    }
  }
  
  // All retries exhausted
  const errorMessage = lastError 
    ? `${lastError.code}: ${lastError.message} (${lastError.suggestion})`
    : 'Unknown error after all retries';
  
  console.error(`❌ ${operationName} failed after ${RETRY_CONFIG.maxRetries + 1} attempts:`, errorMessage);
  throw new Error(errorMessage);
}

/**
 * Validates a player's answers using the OpenAI Assistant
 * @param {string} letter The current round letter
 * @param {Object} answers The player's answers for each category
 * @param {string[]} categories The list of categories to validate
 * @returns {Promise<Object>} Validation results
 */
async function validateAnswers(letter, answers, categories) {
  console.log('🔍 validateAnswers called with letter:', letter);
  console.log('📦 Categories to validate:', categories);
  console.log('📦 Answers to validate:', JSON.stringify(answers, null, 2));
  console.log('🧪 ENVIRONMENT CHECK: OpenAI API Key configured:', !!API_KEY);
  console.log('🧪 ENVIRONMENT CHECK: Running in environment:', process.env.NODE_ENV || 'unknown');
  console.log('🧪 ENVIRONMENT CHECK: Current working directory:', process.cwd());
  
  if (!API_KEY || !ASSISTANT_ID) {
    console.warn('⚠️ OpenAI API Key or Assistant ID not set. Skipping validation.');
    console.log('API_KEY exists:', !!API_KEY);
    console.log('ASSISTANT_ID exists:', !!ASSISTANT_ID);
    
    // Check if we're using the project-style API key
    if (API_KEY && API_KEY.startsWith('sk-proj-')) {
      console.warn('⚠️ Detected project-style API key. Make sure this is compatible with the API version being used.');
    }
    
    console.log('💡 TIP: Check that the .env file is in the correct location and formatted properly.');
    console.log('💡 Current working directory:', process.cwd());
    console.log('💡 Environment variables loaded:', Object.keys(process.env).filter(key => 
      key.includes('OPENAI') || key.includes('API')).join(', '));
    
    throw new Error('OpenAI API Key or Assistant ID not configured');
  }

  // Test API key only when needed, not at module load time
  try {
    console.log('🔑 Testing API key before validation...');
    const isKeyValid = await testApiKey();
    console.log('🔑 API key test result:', isKeyValid ? 'VALID' : 'INVALID');
    
    if (!isKeyValid) {
      console.error('❌ API key test failed during validation request');
      throw new Error('API key validation failed');
    }
  } catch (error) {
    console.error('❌ API key test error:', error.message);
    console.error('❌ API key test stack:', error.stack);
    throw new Error(`API key test failed: ${error.message}`);
  }

  try {
    // Create validation prompt
    const validationPrompt = JSON.stringify({
      task: "Validate user-submitted answers for the game 'Stadt, Land, Fluss'.",
      rules: {
        general: "Each answer must start with the specified letter and fit the category. Be EXTREMELY strict with validation and make sure answers are REAL and ACCURATE. ALWAYS ANSWER IN GERMAN. For any sports-related categories, verify the facts carefully!",
        categories: {
          Stadt: "Must be a real, existing city or town with official city rights. Fictional cities, neighborhoods, districts, misspellings, or made-up names are INVALID. Check for misspellings like 'Föln' instead of 'Köln' and mark them as INVALID. Include geographic location in explanation.",
          Land: "Must be a recognized sovereign country, federal state, or well-known historical region. CITIES like Köln, Berlin, München are NOT countries! Fictional countries or misspellings are INVALID. Include geographic location in explanation.",
          Fluss: "Must be a real, existing river. Streams, creeks, lakes, or fictional rivers are INVALID. Made-up or misspelled river names are INVALID. Include geographic location in explanation.",
          Name: "Must be a commonly recognized first name used for people. Nicknames are valid only if widely recognized. Fictional or made-up names are INVALID. Include origin information in explanation.",
          Beruf: "Must be a recognized official profession or occupation. Gibberish words like 'Kadoesfrf' are INVALID! Obsolete, fictional, or made-up jobs are INVALID. Include a brief description of the profession in explanation.",
          Pflanze: "Must be a specific plant species, including trees, flowers, or crops. Generic terms are INVALID. Made-up or misspelled plant names are INVALID. Include scientific details in explanation.",
          Tier: "Must be a specific animal species, using either scientific or common name. Generic terms, fictional, or made-up animal names are INVALID. Include habitat information in explanation.",
          "BVB Spieler": "ONLY accept verified current or former Borussia Dortmund players. Double-check facts! Names like 'Ziko' which are not real BVB players are INVALID. Include years played for BVB in explanation.",
          "FC Bayern Spieler": "ONLY accept verified current or former FC Bayern München players. Double-check facts! Include years played for Bayern in explanation.",
          "Fußballspieler": "Must be a real, professional football player. Verify they exist! Include team(s) and years active in explanation.",
          "Bundesliga Spieler": "Must be a real player who has played in the German Bundesliga. Verify facts! Include team(s) and years in explanation.",
          // Add dynamic category validation rules
          "*": "For any other category, validate that the answer is real, accurate, and fits the category's theme. Include relevant details in the explanation. For sports categories, be EXTREMELY strict about player/team verification - if unsure, mark as INVALID. For example, for 'Videospiele' (Video Games), validate that it's a real, existing game title and include release year and genre in the explanation.",
          sports_warning: "CRITICAL: For ANY sports-related category (teams, players, clubs, etc.), you MUST verify the factual accuracy. If you're not 100% certain a player played for that team or a fact is correct, mark it as INVALID. Better to be too strict than to allow fake answers!"
        }
      },
      letter,
      answers,
      categories, // Pass the categories to the AI
      output_format: {
        valid: "Boolean indicating if ALL answers are valid",
        errors: "Array of strings describing validation errors for specific answers",
        suggestions: "Object with category keys and string values containing alternate suggestions that start with the required letter",
        explanations: "Object with category keys and string values containing brief explanations for each valid answer AND invalid answer"
      },
      important_instruction: "IMPORTANT: Be EXTREMELY strict in your validation. First check if answers start with the specified letter (case-insensitive). Then verify each answer exists in reality and is correctly spelled - misspelled entries are INVALID. For sports categories (teams, players, etc.), verify factual accuracy - if unsure, mark as INVALID! For each answer, provide an explanation whether it's valid or invalid (1-2 sentences). For invalid answers, explain why it's invalid and suggest valid alternatives that start with the required letter. If an answer looks like a misspelling of a real entity, explicitly point this out in your explanation."
    });

    console.log(`Sending validation request for letter ${letter} with answers:`, answers);
    console.log('API key type:', isProjectKey ? 'Project-style key' : 'Standard key');

    // Create a new thread
    console.log('🔄 Attempting to create thread...');
    let threadId;
    try {
      threadId = await createThread();
      console.log('✅ Thread created successfully:', threadId);
    } catch (error) {
      console.error('❌ Thread creation failed:', error.message);
      logOpenAIError(error, 'createThread');
      throw new Error('Error validating answers: Failed to create thread');
    }

    // Ensure thread cleanup happens regardless of success or failure
    try {
      // Send a message to the thread
    console.log('🔄 Sending message to thread...');
    try {
      await sendMessage(threadId, validationPrompt);
      console.log('✅ Message sent successfully');
    } catch (error) {
      console.error('❌ Message sending failed:', error.message);
      logOpenAIError(error, 'sendMessage');
      throw new Error('Error validating answers: Failed to send message');
    }

    // Run the assistant on the thread
    console.log('🔄 Running assistant...');
    let runId;
    try {
      runId = await runAssistant(threadId);
      console.log('✅ Assistant run started:', runId);
    } catch (error) {
      console.error('❌ Assistant run failed:', error.message);
      logOpenAIError(error, 'runAssistant');
      throw new Error('Error validating answers: Failed to run assistant');
    }

    // Wait for the run to complete
    console.log('🔄 Waiting for run to complete...');
    try {
      await waitForRunCompletion(threadId, runId);
      console.log('✅ Run completed successfully');
    } catch (error) {
      console.error('❌ Run completion failed:', error.message);
      logOpenAIError(error, 'waitForRunCompletion');
      throw new Error('Error validating answers: Run failed to complete');
    }

    // Get the messages from the thread
    console.log('🔄 Getting messages from thread...');
    let messages;
    try {
      messages = await getMessages(threadId);
      console.log('✅ Retrieved messages successfully');
    } catch (error) {
      console.error('❌ Failed to get messages:', error.message);
      logOpenAIError(error, 'getMessages');
      throw new Error('Error validating answers: Failed to get messages');
    }

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
      
      // Process the validation results for each player
      const playerResults = {};
      
      // For each player's answers
      Object.entries(answers).forEach(([playerId, playerAnswers]) => {
        playerResults[playerId] = {};
        
        // For each category
        Object.entries(playerAnswers).forEach(([category, answer]) => {
          if (!answer) {
            playerResults[playerId][category] = {
              valid: false,
              explanation: "Keine Antwort angegeben",
              suggestions: null
            };
            return;
          }
          
          // Get the validation result for this category
          const categoryValidation = {
            valid: parsedResponse.valid,
            explanation: parsedResponse.explanations?.[category] || "Keine Erklärung verfügbar",
            suggestions: parsedResponse.suggestions?.[category] || null
          };
          
          // Check if the answer starts with the correct letter
          if (!answer.toLowerCase().startsWith(letter.toLowerCase())) {
            categoryValidation.valid = false;
            categoryValidation.explanation = `"${answer}" beginnt nicht mit dem Buchstaben "${letter}".`;
            categoryValidation.suggestions = null;
          }
          
          // Check for common misspellings in Stadt category
          if (category === 'Stadt') {
            const misspellings = {
              "Föln": "Köln",
              "Koln": "Köln",
              "Muenchen": "München",
              "Munchen": "München",
              "Frankfort": "Frankfurt",
              "Nurnberg": "Nürnberg",
              "Nurenberg": "Nürnberg",
              "Dusseldorf": "Düsseldorf"
            };
            
            if (Object.keys(misspellings).includes(answer)) {
              const correctCity = misspellings[answer];
              categoryValidation.valid = false;
              categoryValidation.explanation = `"${answer}" ist eine falsche Schreibweise von "${correctCity}".`;
              categoryValidation.suggestions = correctCity;
            }
          }
          
          playerResults[playerId][category] = categoryValidation;
        });
      });
      
      return playerResults;
    } catch (e) {
      console.error('Failed to parse assistant response as JSON:', content);
      console.error('Parse error:', e);
      
      throw new Error(`Failed to parse AI response: ${e.message}`);
    }
    } finally {
      // Clean up the thread to prevent memory leaks
      if (threadId) {
        await deleteThread(threadId);
      }
    }
  } catch (error) {
    console.error('Error in validateAnswers:', error);
    
    // Log useful debugging info
    if (error.response) {
      console.error('OpenAI API Error Response:');
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      console.error('Headers:', error.response.headers);
    }
    
    throw error; // Re-throw the error instead of returning fallback
  }
}

// Add a helper function to log OpenAI API errors in a consistent way
function logOpenAIError(error, operation) {
  console.error(`OpenAI API Error during ${operation}:`);
  
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    console.error('Status:', error.response.status);
    console.error('Data:', error.response.data);
    console.error('Headers:', error.response.headers);
    
    // Check for specific error types
    if (error.response.status === 401) {
      console.error('⚠️ AUTHENTICATION ERROR: Your API key is invalid or has expired');
      if (API_KEY.startsWith('sk-proj-')) {
        console.error('⚠️ You are using a project-style API key. Make sure it has the proper permissions and is correctly formatted.');
      }
    } else if (error.response.status === 429) {
      console.error('⚠️ RATE LIMIT ERROR: You have exceeded your API quota or rate limit');
    } else if (error.response.status === 500) {
      console.error('⚠️ SERVER ERROR: OpenAI service is experiencing issues');
    }
  } else if (error.request) {
    // The request was made but no response was received
    console.error('Request made but no response received');
    console.error('Request details:', error.request);
  } else {
    // Something happened in setting up the request that triggered an Error
    console.error('Error during request setup:', error.message);
  }
}

module.exports = { validateAnswers }; 