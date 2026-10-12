const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/app.js', 'utf8');

function playback() {
  const players = [], spoken = [], handlers = {};
  const context = {
    APP_VERSION: '1.3.2',
    localStorage: { getItem: () => null },
    SpeechSynthesisUtterance: function(text) { this.text = text; },
    window: { speechSynthesis: { cancel() {}, getVoices: () => [], speak: u => spoken.push(u.text) } },
    document: { addEventListener: (name, fn) => handlers[name] = fn },
    Audio: function(url) {
      this.url = url;
      this.pause = () => this.paused = true;
      this.play = () => ({ catch: fn => this.reject = fn });
      players.push(this);
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function getVoicePref()'), source.indexOf('function initVoiceSettings()')), context);
  return { context, players, spoken, handlers };
}

test('word and example requests use versioned audio URLs and share playback speed', () => {
  const { context, players, handlers } = playback();
  context.speak('がっこう', 'word-1');
  assert.equal(players[0].url, '/api/audio/word-1.mp3?v=1.3.2');
  const attributes = { 'data-text': '学校に行きます。', 'data-audio': '/api/audio/examples/abc.mp3' };
  handlers.click({ target: { closest: () => ({ getAttribute: name => attributes[name] }) } });
  assert.equal(players[1].url, '/api/audio/examples/abc.mp3?v=1.3.2');
  assert.equal(players[1].playbackRate, 0.8);
  assert.equal(players[0].paused, true);
});

test('a missing example falls back once; a superseded request cannot interrupt new audio', () => {
  const { context, players, spoken } = playback();
  context.speak('古い例句', null, '/api/audio/examples/old.mp3');
  context.speak('新しい例句', null, '/api/audio/examples/new.mp3');
  players[0].reject();
  assert.deepEqual(spoken, []);
  players[1].onerror();
  players[1].reject();
  assert.deepEqual(spoken, ['新しい例句']);
});
