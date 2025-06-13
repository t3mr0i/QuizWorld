// Error handling and retry logic utilities
export class ErrorHandler {
    static MAX_RETRIES = 3;
    static BASE_DELAY = 1000;
    static MAX_DELAY = 10000;

    static async retry(operation, operationName, maxRetries = this.MAX_RETRIES) {
        let lastError = null;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🔄 ${operationName} - Attempt ${attempt + 1}/${maxRetries + 1}`);
                return await operation();
            } catch (error) {
                lastError = error;
                
                const errorInfo = this.categorizeError(error);
                console.warn(`⚠️ ${operationName} failed (attempt ${attempt + 1}):`, {
                    type: errorInfo.type,
                    message: errorInfo.message,
                    retryable: errorInfo.retryable
                });
                
                // Don't retry if error is not retryable or we're on the last attempt
                if (!errorInfo.retryable || attempt === maxRetries) {
                    break;
                }
                
                // Calculate and apply backoff delay
                const delayMs = this.calculateBackoffDelay(attempt);
                console.log(`⏳ Waiting ${delayMs}ms before retry...`);
                await this.delay(delayMs);
            }
        }
        
        console.error(`❌ ${operationName} failed after ${maxRetries + 1} attempts:`, lastError);
        throw lastError;
    }

    static categorizeError(error) {
        // Network errors
        if (error.name === 'NetworkError' || error.code === 'NETWORK_ERROR') {
            return {
                type: 'network',
                message: 'Network connection failed',
                retryable: true,
                userMessage: 'Connection issue. Please check your internet connection.'
            };
        }
        
        // WebSocket errors
        if (error.name === 'WebSocketError' || error.type === 'websocket') {
            return {
                type: 'websocket',
                message: 'WebSocket connection failed',
                retryable: true,
                userMessage: 'Connection to game server lost. Attempting to reconnect...'
            };
        }
        
        // AI/API errors
        if (error.message?.includes('AI') || error.message?.includes('assistant')) {
            return {
                type: 'ai',
                message: error.message,
                retryable: !error.message.includes('AUTH_ERROR'),
                userMessage: 'AI service temporarily unavailable. Please try again.'
            };
        }
        
        // Validation errors (user input)
        if (error.name === 'ValidationError') {
            return {
                type: 'validation',
                message: error.message,
                retryable: false,
                userMessage: error.message
            };
        }
        
        // Generic errors
        return {
            type: 'unknown',
            message: error.message || 'Unknown error occurred',
            retryable: true,
            userMessage: 'Something went wrong. Please try again.'
        };
    }

    static calculateBackoffDelay(attempt) {
        const delay = Math.min(
            this.BASE_DELAY * Math.pow(2, attempt),
            this.MAX_DELAY
        );
        // Add jitter to prevent thundering herd
        return delay + Math.random() * 1000;
    }

    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static showUserError(error, fallbackMessage = 'An error occurred. Please try again.') {
        const errorInfo = this.categorizeError(error);
        const message = errorInfo.userMessage || fallbackMessage;
        
        // Show user-friendly error message
        this.showErrorToast(message);
        
        // Log technical details for debugging
        console.error('User error:', {
            type: errorInfo.type,
            message: errorInfo.message,
            original: error
        });
    }

    static showErrorToast(message) {
        // Create or update error toast
        let toast = document.getElementById('error-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'error-toast';
            toast.className = 'error-toast';
            toast.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #ff4444;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                z-index: 10000;
                display: none;
                opacity: 0;
                transition: opacity 0.3s ease;
                max-width: 300px;
                word-wrap: break-word;
                font-family: system-ui, -apple-system, sans-serif;
            `;
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.style.display = 'block';
        setTimeout(() => {
            toast.style.opacity = '1';
        }, 10);
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.style.display = 'none';
            }, 300);
        }, 5000);
    }
} 