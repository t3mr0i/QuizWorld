# Quizaru Test Suite

This directory contains comprehensive tests for the Quizaru application, covering frontend, backend, integration, and performance testing.

## Test Structure

```
tests/
├── README.md                    # This file
├── setup.js                     # Global test setup and mocks
├── quiz-game-client.test.js     # Frontend client tests
├── server.test.ts               # Server functionality tests
├── validators.test.ts           # Validation logic tests
├── integration.test.js          # End-to-end integration tests
└── performance.test.js          # Performance and load tests
```

## Running Tests

### All Tests
```bash
npm test                    # Run all tests in watch mode
npm run test:run           # Run all tests once
npm run test:watch         # Run tests in watch mode
```

### Specific Test Categories
```bash
npm run test:client        # Frontend client tests only
npm run test:server        # Server and validation tests
npm run test:integration   # Integration tests
npm run test:performance   # Performance tests
```

### Coverage and UI
```bash
npm run test:coverage      # Run tests with coverage report
npm run test:ui           # Run tests with Vitest UI
```

## Test Categories

### 1. Frontend Client Tests (`quiz-game-client.test.js`)

Tests the `QuizGameClient` class and related frontend functionality:

- **Initialization**: Game state setup, database initialization
- **Screen Management**: Navigation between different screens
- **Room Code Generation**: Unique 6-digit room codes
- **Player Management**: Host identification, player data
- **Scoring System**: 100 points per correct answer, leaderboard sorting
- **Loading States**: Loading overlay show/hide functionality
- **Toast Notifications**: Success/error message display
- **Modal Dialogs**: Alert, confirm, and prompt modals
- **Quiz Display**: Quiz list rendering and interaction
- **Tournament Functionality**: Quiz selection, combination, shuffling
- **WebSocket Connection**: Real-time communication setup

### 2. Server Tests (`server.test.ts`)

Tests the PartyKit server functionality:

- **Quiz Creation**: AI-generated quiz creation and session setup
- **Tournament Creation**: Combined quiz tournaments
- **Existing Quiz Play**: Loading and playing saved quizzes
- **Session Management**: Player joining, ready states, host controls
- **Game Flow**: Question progression, answer submission, scoring
- **Error Handling**: Invalid messages, unauthorized actions
- **Multiplayer Scenarios**: Multiple players, synchronization

### 3. Validation Tests (`validators.test.ts`)

Tests answer validation logic:

- **Basic Validation**: Letter-based answer checking
- **Case Sensitivity**: Proper case handling
- **Empty Answers**: Handling missing responses
- **Multiple Players**: Validation across different players

### 4. Integration Tests (`integration.test.js`)

Tests complete user flows:

- **Complete Quiz Flow**: From welcome screen to final results
- **Quiz Creation Flow**: Creating new quizzes with AI
- **Tournament Creation**: Multi-quiz tournament setup
- **Scoring Accuracy**: Correct point calculation and leaderboard
- **Error Scenarios**: Graceful error handling
- **Database Integration**: Save/retrieve operations
- **Real-time Features**: WebSocket message handling

### 5. Performance Tests (`performance.test.js`)

Tests application performance under load:

- **Quiz Rendering**: Large quiz list rendering efficiency
- **Leaderboard Updates**: Rapid score updates
- **Memory Usage**: Memory leak prevention
- **Tournament Combinations**: Large quiz combination performance
- **Network Simulation**: Slow network response handling
- **UI Responsiveness**: Maintaining smooth UI during heavy operations

## Test Configuration

### Vitest Configuration (`vitest.config.js`)
- **Environment**: jsdom for DOM testing
- **Setup Files**: Global mocks and utilities
- **Coverage**: V8 provider with HTML/JSON reports
- **Aliases**: Path resolution for imports

### Global Setup (`setup.js`)
- **Mock Reset**: Clears all mocks before each test
- **Console Mocking**: Reduces test noise
- **Global Objects**: localStorage, sessionStorage, fetch, crypto
- **Environment Polyfills**: URL, crypto for older environments

## Mocking Strategy

### Firebase Mocking
- Mock database operations (save, retrieve, query)
- Simulated quiz data and highscores
- Async operation simulation

### WebSocket Mocking
- Mock real-time communication
- Simulated server responses
- Connection state management

### DOM Mocking
- jsdom environment for browser APIs
- Element creation and manipulation
- Event simulation

## Coverage Goals

The test suite aims for:
- **90%+ Line Coverage**: Most code paths tested
- **80%+ Branch Coverage**: Decision points covered
- **100% Critical Path Coverage**: Core functionality fully tested

## Best Practices

### Writing Tests
1. **Descriptive Names**: Clear test descriptions
2. **Arrange-Act-Assert**: Structured test organization
3. **Isolation**: Each test is independent
4. **Mocking**: External dependencies mocked appropriately
5. **Async Handling**: Proper async/await usage

### Performance Tests
1. **Realistic Data**: Use representative data sizes
2. **Time Limits**: Set reasonable performance expectations
3. **Memory Monitoring**: Check for memory leaks
4. **User Experience**: Focus on perceived performance

### Integration Tests
1. **End-to-End Flows**: Test complete user journeys
2. **Error Scenarios**: Test failure cases
3. **State Management**: Verify state consistency
4. **Real-world Simulation**: Use realistic test data

## Continuous Integration

Tests are designed to run in CI environments:
- **Fast Execution**: Most tests complete quickly
- **Deterministic**: Consistent results across runs
- **Environment Independent**: Work in various Node.js versions
- **Parallel Safe**: Tests can run concurrently

## Debugging Tests

### Common Issues
1. **Async Timing**: Use proper async/await patterns
2. **DOM Cleanup**: Ensure DOM is reset between tests
3. **Mock State**: Clear mocks between tests
4. **Memory Leaks**: Check for retained references

### Debug Commands
```bash
# Run specific test file
npx vitest run tests/quiz-game-client.test.js

# Run with debug output
DEBUG=* npm test

# Run single test
npx vitest run -t "should generate 6-digit room codes"
```

## Contributing

When adding new features:
1. **Add Tests**: Write tests for new functionality
2. **Update Existing**: Modify tests for changed behavior
3. **Performance**: Consider performance implications
4. **Documentation**: Update test documentation

### Test Checklist
- [ ] Unit tests for new functions/methods
- [ ] Integration tests for new user flows
- [ ] Performance tests for heavy operations
- [ ] Error handling tests
- [ ] Mock updates for external dependencies 