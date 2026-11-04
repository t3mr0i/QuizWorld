import { test } from 'node:test';
import assert from 'node:assert/strict';
import Server from '../partykit/server.ts';

let id = 0;
async function room() {
  const messages = [];
  const server = new Server({ id: `state-test-${++id}`, broadcast: text => messages.push(JSON.parse(text)) });
  const host = { id: 'host', send() {} }, guest = { id: 'guest', send() {} };
  const send = (player, type, data = {}) => server.onMessage(JSON.stringify({ type, ...data }), player);
  await send(host, 'play_existing_quiz', { quizId: 'quiz', quiz: { id: 'quiz', title: 'Quiz', questions: [0, 1].map(i => ({ id: `q${i}`, question: `Q${i}`, options: ['yes', 'no'], correctAnswer: 0 })) } });
  const state = () => messages.filter(m => m.type === 'session_update').at(-1).session;
  return { server, host, guest, send, state };
}

test('repeated join preserves the host and an already submitted answer', async () => {
  const r = await room();
  await r.send(r.guest, 'join_session', { playerName: 'Guest' });
  for (const p of [r.host, r.guest]) await r.send(p, 'player_ready', { ready: true });
  await r.send(r.host, 'start_quiz');
  await r.send(r.host, 'submit_answer', { answerIndex: 0, questionIndex: 0 });
  await r.send(r.host, 'join_session', { playerName: 'Host again' });
  assert.equal(r.state().players.host.isHost, true);
  assert.equal(r.state().players.host.hasAnswered, true);
  await r.send(r.host, 'submit_answer', { answerIndex: 1, questionIndex: 0 });
  assert.equal(r.state().players.host.currentAnswer, 0);
});

test('start and next commands cannot restart, skip or double-advance an active question', async () => {
  const r = await room();
  await r.send(r.host, 'next_question');
  assert.equal(r.state().currentQuestionIndex, -1);
  await r.send(r.host, 'start_quiz');
  await r.send(r.host, 'next_question');
  assert.equal(r.state().currentQuestionIndex, 0);
  await r.send(r.host, 'submit_answer', { answerIndex: 0, questionIndex: 0 });
  await r.send(r.host, 'start_quiz');
  assert.equal(r.state().players.host.score, 100);
  assert.equal(r.state().gameState, 'results');
  await r.send(r.host, 'next_question', { questionIndex: 0 });
  await r.send(r.host, 'next_question', { questionIndex: 0 });
  assert.equal(r.state().currentQuestionIndex, 1);
});

test('the last unanswered player leaving releases the results transition exactly once', async () => {
  const r = await room();
  await r.send(r.guest, 'join_session');
  for (const p of [r.host, r.guest]) await r.send(p, 'player_ready', { ready: true });
  await r.send(r.host, 'start_quiz');
  await r.send(r.host, 'submit_answer', { answerIndex: 0 });
  r.server.onClose(r.guest);
  assert.equal(r.state().gameState, 'results');
  assert.equal(r.state().players.host.score, 100);
  r.server.onClose(r.guest);
  assert.equal(r.state().players.host.score, 100);
});

test('invalid and stale answers do not consume the current answer slot', async () => {
  const r = await room();
  await r.send(r.host, 'start_quiz');
  for (const answerIndex of [null, '0', 0.5, -2, 2]) await r.send(r.host, 'submit_answer', { answerIndex });
  await r.send(r.host, 'submit_answer', { answerIndex: 0, questionIndex: -1 });
  assert.equal(r.state().players.host.hasAnswered, false);
  await r.send(r.host, 'submit_answer', { answerIndex: -1, questionIndex: 0 });
  assert.equal(r.state().gameState, 'results');
  assert.equal(r.state().players.host.score, 0);
});

test('an empty room drops its orphaned session', async () => {
  const r = await room();
  r.server.onClose(r.host);
  const sent = [];
  await r.server.onConnect({ id: 'replacement', send: text => sent.push(JSON.parse(text)) });
  assert.equal(sent.length, 0);
});
