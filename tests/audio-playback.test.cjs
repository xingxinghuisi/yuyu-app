const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/app.js', 'utf8');

function playback(config = {}) {
  const players = [], spoken = [], utterances = [], handlers = {}, graphs = [];
  const storage = new Map(config.stored == null ? [] : [['yuyu_voice_volume', config.stored]]);
  const context = {
    APP_VERSION: '1.3.2',
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) },
    SpeechSynthesisUtterance: function(text) { this.text = text; },
    window: { addEventListener: (name, fn) => handlers['window:' + name] = fn,
      speechSynthesis: { cancel() {}, getVoices: () => [], speak: u => { spoken.push(u.text); utterances.push(u); } } },
    $: () => null, $$: () => [],
    document: { addEventListener: (name, fn) => handlers[name] = fn },
    Audio: function(url) {
      this.url = url;
      this.pause = () => this.paused = true;
      this.play = () => ({ catch: fn => this.reject = fn });
      players.push(this);
    }
  };
  if (config.webAudio) context.window.AudioContext = function () {
    this.state = config.suspended ? 'suspended' : 'running';this.currentTime = 0;this.destination = {};
    this.sources = [];
    this.createGain = () => this.gain = { connect() {}, gain: { value: 1, setTargetAtTime(value) { this.value = value; } } };
    this.createDynamicsCompressor = () => ({ connect() {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} });
    this.createMediaElementSource = audio => {
      const source = { audio, connect() {}, disconnect() { this.disconnected = true; } };
      this.sources.push(source);return source;
    };
    this.resume = () => config.suspended ? new Promise(() => {}) : Promise.resolve();
    graphs.push(this);
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('var VOICE_VOLUME_KEY'), source.indexOf('function initVoiceSettings()')), context);
  return { context, players, spoken, utterances, handlers, storage, graphs };
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

test('saved pronunciation volume controls words, examples and TTS without affecting playback rate', () => {
  const { context, players, utterances, storage } = playback({ stored:'0.35' });
  context.speak('ことば','word');
  assert.equal(players[0].volume,0.35);assert.equal(players[0].playbackRate,0.8);
  context.setVoiceVolume(0);
  assert.equal(players[0].volume,0);assert.equal(players[0].muted,true);
  context.setVoiceVolume(0.6);
  assert.equal(players[0].muted,false);assert.equal(players[0].volume,0.6);
  context.speak('例句',null,'/api/audio/examples/demo.mp3');
  assert.equal(players[1].volume,0.6);assert.equal(storage.get('yuyu_voice_volume'),'0.6');
  players[1].onerror();assert.equal(utterances[0].volume,0.6);
});

test('recording boost uses real gain above one, reuses its context and disconnects superseded nodes', () => {
  const { context, players, graphs, utterances } = playback({ stored:'2',webAudio:true });
  context.speak('ひとつ','one');
  assert.equal(players[0].volume,1);assert.equal(graphs[0].gain.gain.value,2);
  context.setVoiceVolume(0.5);assert.equal(graphs[0].gain.gain.value,0.5);
  context.setVoiceVolume(1.5);assert.equal(graphs[0].sources.length,1,'Do not create a second media source for the same element');
  context.speak('ふたつ','two');
  assert.equal(graphs.length,1);assert.equal(graphs[0].sources[0].disconnected,true);
  assert.equal(graphs[0].gain.gain.value,1.5);
  players[1].onerror();assert.equal(graphs[0].sources[1].disconnected,true);
  assert.equal(utterances[0].volume,1,'TTS obeys its platform maximum');
});

test('unsupported or still-locked audio processing preserves audible media rather than connecting a silent source', () => {
  for (const config of [{stored:'2'}, {stored:'2',webAudio:true,suspended:true}]) {
    const {context,players,graphs}=playback(config);context.speak('音声','word');
    assert.equal(players[0].volume,1);
    assert.equal(graphs[0]?.sources.length||0,0);
  }
});

test('invalid settings are clamped and storage events update current audio without writing back', () => {
  const {context,players,handlers,storage}=playback({stored:'bad'});
  context.speak('声','word');assert.equal(players[0].volume,1);
  context.setVoiceVolume(10);assert.equal(storage.get('yuyu_voice_volume'),'2');
  handlers['window:storage']({key:'yuyu_voice_volume',newValue:'0.2'});
  assert.equal(players[0].volume,0.2);assert.equal(storage.get('yuyu_voice_volume'),'2');
  context.setVoiceVolume(-2);assert.equal(players[0].muted,true);
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
