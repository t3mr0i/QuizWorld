import { vi } from 'vitest';

// Global test setup
beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Mock console methods to reduce noise in tests
    global.console = {
        ...console,
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    };
});

// Mock global objects that might be needed
global.fetch = vi.fn();
global.localStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
};

global.sessionStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
};

// Mock URL constructor for environments that don't have it
if (typeof URL === 'undefined') {
    global.URL = class URL {
        constructor(url, base) {
            this.href = url;
            this.origin = base || '';
        }
    };
}

// Mock crypto for environments that don't have it
if (typeof crypto === 'undefined') {
    global.crypto = {
        getRandomValues: vi.fn((arr) => {
            for (let i = 0; i < arr.length; i++) {
                arr[i] = Math.floor(Math.random() * 256);
            }
            return arr;
        })
    };
} 