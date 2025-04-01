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
    return { valid: true, errors: [], suggestions: {}, explanations: {} };
  }

  try {
    // Create validation prompt
    const validationPrompt = JSON.stringify({
      task: "Validate user-submitted answers for the game 'Stadt, Land, Fluss'.",
      rules: {
        general: "Each answer must start with the specified letter and fit the category. Be EXTREMELY strict with validation and make sure answers are REAL and ACCURATE.",
        categories: {
          Stadt: "Must be a real, existing city or town with official city rights. Fictional cities, neighborhoods, districts, misspellings, or made-up names are INVALID. Check for misspellings like 'Föln' instead of 'Köln' and mark them as INVALID. Include geographic location in explanation.",
          Land: "Must be a recognized sovereign country, federal state, or well-known historical region. Fictional countries or misspellings are INVALID. Include geographic location in explanation.",
          Fluss: "Must be a real, existing river. Streams, creeks, lakes, or fictional rivers are INVALID. Made-up or misspelled river names are INVALID. Include geographic location in explanation.",
          Name: "Must be a commonly recognized first name used for people. Nicknames are valid only if widely recognized. Fictional or made-up names are INVALID. Include origin information in explanation.",
          Beruf: "Must be a recognized official profession or occupation. Obsolete, fictional, or made-up jobs are INVALID. Include a brief description of the profession in explanation.",
          Pflanze: "Must be a specific plant species, including trees, flowers, or crops. Generic terms are INVALID. Made-up or misspelled plant names are INVALID. Include scientific details in explanation.",
          Tier: "Must be a specific animal species, using either scientific or common name. Generic terms, fictional, or made-up animal names are INVALID. Include habitat information in explanation."
        }
      },
      letter,
      answers,
      output_format: {
        valid: "Boolean indicating if ALL answers are valid",
        errors: "Array of strings describing validation errors for specific answers",
        suggestions: "Object with category keys and string values containing alternate suggestions that start with the required letter",
        explanations: "Object with category keys and string values containing brief explanations for each valid answer AND invalid answer"
      },
      important_instruction: "IMPORTANT: Be EXTREMELY strict in your validation. First check if answers start with the specified letter (case-insensitive). Then verify each answer exists in reality and is correctly spelled - misspelled entries like 'Föln' instead of 'Köln' are INVALID. For each answer, provide an explanation whether it's valid or invalid (1-2 sentences). For invalid answers, explain why it's invalid and suggest valid alternatives that start with the required letter. If an answer looks like a misspelling of a real entity, explicitly point this out in your explanation."
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
      
      // Ensure explanations object exists
      if (!parsedResponse.explanations) {
        parsedResponse.explanations = {};
      }
      
      // Generate explanations for any missing categories
      Object.keys(answers).forEach(category => {
        const answer = answers[category];
        if (answer && !parsedResponse.explanations[category]) {
          if (parsedResponse.errors && parsedResponse.errors.some(err => err.includes(category))) {
            // Find matching error
            const matchingError = parsedResponse.errors.find(err => err.includes(category));
            parsedResponse.explanations[category] = matchingError || 
              `"${answer}" is not a valid ${category} starting with "${letter}". It may be misspelled or not exist.`;
          } else if (parsedResponse.valid) {
            // Generate basic explanation for valid answer
            parsedResponse.explanations[category] = 
              `"${answer}" is a valid ${category} starting with "${letter}".`;
          }
        }
      });
      
      // Check for common misspellings in Stadt category
      if (answers.Stadt && typeof answers.Stadt === 'string') {
        const stadtAnswer = answers.Stadt.trim();
        
        // List of commonly misspelled German cities
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
        
        // Check if answer is a known misspelling
        if (Object.keys(misspellings).includes(stadtAnswer)) {
          const correctCity = misspellings[stadtAnswer];
          
          // Only mark as invalid if the correct spelling starts with the same letter
          if (correctCity.toLowerCase().startsWith(letter.toLowerCase())) {
            if (!parsedResponse.errors) parsedResponse.errors = [];
            
            const errorMsg = `Stadt: "${stadtAnswer}" appears to be a misspelling of "${correctCity}" and is therefore invalid.`;
            if (!parsedResponse.errors.includes(errorMsg)) {
              parsedResponse.errors.push(errorMsg);
            }
            
            parsedResponse.explanations.Stadt = errorMsg;
            parsedResponse.valid = false;
            
            // Add a suggestion
            if (!parsedResponse.suggestions) parsedResponse.suggestions = {};
            parsedResponse.suggestions.Stadt = correctCity;
          }
        }
      }
      
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
      const explanations = {};
      const suggestions = {};
      
      categories.forEach(category => {
        const answer = answers[category];
        if (!answer) return;
        
        // Check if answer starts with the correct letter (case insensitive)
        if (!answer.toLowerCase().startsWith(letter.toLowerCase())) {
          const errorMsg = `${category}: "${answer}" does not start with the letter "${letter}"`;
          errors.push(errorMsg);
          explanations[category] = errorMsg;
          allValid = false;
        } else {
          // Look for category-specific validation issues in the text
          if (content.toLowerCase().includes(`${category.toLowerCase()}`) && 
              content.toLowerCase().includes(`${answer.toLowerCase()}`)) {
            
            // Find specific error message for this category
            const lines = content.split('\n');
            let foundExplanation = false;
            
            for (const line of lines) {
              if (line.toLowerCase().includes(category.toLowerCase()) && 
                  line.toLowerCase().includes(answer.toLowerCase())) {
                
                if (line.toLowerCase().includes('invalid') || 
                    line.toLowerCase().includes('error') || 
                    line.toLowerCase().includes('not valid') ||
                    line.toLowerCase().includes('misspell')) {
                  errors.push(`${category}: ${line.trim()}`);
                  explanations[category] = line.trim();
                  allValid = false;
                  foundExplanation = true;
                  
                  // Look for suggested alternatives
                  const suggestionMatch = line.match(/suggest\w*\s+['""]?([^'""]+)['""]?/i) || 
                                         content.match(new RegExp(`${category}[^.]*suggest\\w*\\s+['"\`]?([^'"\`]+)['"\`]?`, 'i'));
                  if (suggestionMatch && suggestionMatch[1]) {
                    suggestions[category] = suggestionMatch[1].trim();
                  }
                } else {
                  explanations[category] = line.trim();
                  foundExplanation = true;
                }
                break;
              }
            }
            
            if (!foundExplanation) {
              explanations[category] = `"${answer}" is a valid ${category} starting with "${letter}".`;
            }
          } else {
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
                const errorMsg = `${category}: "${answer}" appears to be a misspelling of "${correctCity}" and is therefore invalid.`;
                errors.push(errorMsg);
                explanations[category] = errorMsg;
                suggestions[category] = correctCity;
                allValid = false;
              } else {
                explanations[category] = `"${answer}" is a valid ${category} starting with "${letter}".`;
              }
            } else {
              explanations[category] = `"${answer}" is a valid ${category} starting with "${letter}".`;
            }
          }
        }
      });
      
      // Create suggestions object from content if not already populated
      if (Object.keys(suggestions).length === 0) {
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
      }
      
      // If parsing fails, return a structured response
      const result = {
        valid: allValid,
        errors,
        suggestions,
        explanations
      };
      
      console.log('Extracted validation result from text:', result);
      return result;
    }
  } catch (error) {
    console.error('Error validating answers with OpenAI Assistant:', error);
    
    // Fallback validation if API fails
    const errors = [];
    let allValid = true;
    const explanations = {};
    const suggestions = {};
    
    // Basic validation: check if answers start with the correct letter
    Object.entries(answers).forEach(([category, answer]) => {
      if (!answer) return;
      
      if (!answer.toLowerCase().startsWith(letter.toLowerCase())) {
        const errorMsg = `${category}: "${answer}" does not start with the letter "${letter}"`;
        errors.push(errorMsg);
        explanations[category] = errorMsg;
        allValid = false;
      } else if (category === 'Stadt') {
        // Check for common misspellings in Stadt category
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
          const errorMsg = `${category}: "${answer}" appears to be a misspelling of "${correctCity}" and is therefore invalid.`;
          errors.push(errorMsg);
          explanations[category] = errorMsg;
          suggestions[category] = correctCity;
          allValid = false;
        } else {
          explanations[category] = `"${answer}" starts with the letter "${letter}".`;
        }
      } else {
        explanations[category] = `"${answer}" starts with the letter "${letter}".`;
      }
    });
    
    const result = {
      valid: allValid,
      errors,
      suggestions,
      explanations
    };
    
    console.log('Fallback validation result:', result);
    return result;
  }
}

module.exports = { validateAnswers }; 