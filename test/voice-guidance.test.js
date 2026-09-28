/**
 * public/js/voice-guidance.js (docs/sign-in-plan.md, step 3).
 *
 * Plain, dependency-injected JavaScript, like signin-messages.js: loaded and
 * exercised directly in Node with vm, with fakes standing in for
 * speechSynthesis, SpeechSynthesisUtterance and localStorage. No browser
 * involved at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadVoiceGuidance() {
  const source = readFileSync(join(projectRoot, 'public/js/voice-guidance.js'), 'utf8');
  const sandbox = { window: {}, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.VoiceGuidance;
}

/** A fake SpeechSynthesisUtterance: records the text and lang it was given. */
function FakeUtterance(text) {
  this.text = text;
  this.lang = null;
  this.onend = null;
  this.onerror = null;
}

/** A fake speechSynthesis: records speak()/cancel() calls, nothing more. */
function createFakeSpeech() {
  return {
    spoken: [], // every utterance passed to speak()
    cancelCount: 0,
    speak(utterance) {
      this.spoken.push(utterance);
    },
    cancel() {
      this.cancelCount += 1;
    },
  };
}

/** A fake localStorage backed by a plain object, or one that always throws. */
function createFakeStorage(options = {}) {
  if (options.throws) {
    return {
      getItem() {
        throw new Error('storage unavailable');
      },
      setItem() {
        throw new Error('storage unavailable');
      },
    };
  }
  const values = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      values[key] = String(value);
    },
  };
}

// A tiny fixed catalogue standing in for SignInMessages.spokenLine.
function fakeLines(key) {
  const lines = {
    intro: 'Intro line.',
    opening: 'Opening line.',
    checking: 'Checking line.',
    'not-verified': 'Not verified line.',
  };
  return Object.prototype.hasOwnProperty.call(lines, key) ? lines[key] : null;
}

const VoiceGuidance = loadVoiceGuidance();

describe('VoiceGuidance.create', () => {
  it('is off by default', () => {
    const guidance = VoiceGuidance.create({
      speech: createFakeSpeech(),
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    assert.equal(guidance.isOn(), false);
  });

  it('speaks nothing from say() while off', () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    guidance.say('opening');
    assert.equal(speech.spoken.length, 0);
  });

  it('turnOn persists "on", and a new guidance built on the same storage starts on', () => {
    const storage = createFakeStorage();
    const first = VoiceGuidance.create({
      speech: createFakeSpeech(),
      Utterance: FakeUtterance,
      storage,
      lines: fakeLines,
    });
    first.turnOn();
    assert.equal(first.isOn(), true);

    const second = VoiceGuidance.create({
      speech: createFakeSpeech(),
      Utterance: FakeUtterance,
      storage,
      lines: fakeLines,
    });
    assert.equal(second.isOn(), true);
  });

  it('a storage that throws on every access stays off, but turnOn still works for the session', () => {
    const storage = createFakeStorage({ throws: true });
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({ speech, Utterance: FakeUtterance, storage, lines: fakeLines });

    assert.equal(guidance.isOn(), false);
    assert.doesNotThrow(() => guidance.turnOn());
    assert.equal(guidance.isOn(), true);

    guidance.say('opening');
    assert.equal(speech.spoken.length, 1, 'expected say() to work for the rest of this session');
  });

  it('say() cancels first, speaks with lang en-GB, and remembers the key', () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    guidance.turnOn();
    guidance.say('opening');

    assert.equal(speech.cancelCount, 1, 'expected say() to cancel before speaking');
    assert.equal(speech.spoken.length, 1);
    assert.equal(speech.spoken[0].text, 'Opening line.');
    assert.equal(speech.spoken[0].lang, 'en-GB');
  });

  it('say() with an unknown key speaks nothing and does not cancel', () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    guidance.turnOn();
    guidance.say('not-a-real-key');

    assert.equal(speech.spoken.length, 0);
    assert.equal(speech.cancelCount, 0);
  });

  it('sayAndWait resolves after maxMs when the fake utterance never fires "end"', async () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    guidance.turnOn();

    const started = Date.now();
    await guidance.sayAndWait('opening', 20);
    assert.ok(Date.now() - started >= 20, 'expected the promise to wait for the cap');
    assert.equal(speech.spoken.length, 1);
  });

  it('sayAndWait resolves early when the utterance fires "end"', async () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    guidance.turnOn();

    const promise = guidance.sayAndWait('opening', 5000);
    // The fake speech object doesn't fire events on its own; fire it as the
    // real Web Speech API would once the utterance finishes.
    speech.spoken[0].onend();

    const started = Date.now();
    await promise;
    assert.ok(Date.now() - started < 1000, 'expected the promise to resolve well before the 5s cap');
  });

  it('replay repeats the latest status even if it was announced while guidance was off', () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });

    // Guidance is off (the default): a failure happens and say() is called,
    // but nothing should be spoken yet — this is the case replay() has to
    // cover, since a user often turns guidance on only after something has
    // already gone wrong.
    guidance.say('not-verified');
    assert.equal(speech.spoken.length, 0, 'expected no speech while guidance is off');

    guidance.turnOn();
    guidance.replay();

    const spokenTexts = speech.spoken.map((utterance) => utterance.text);
    assert.deepEqual(spokenTexts, ['Intro line.', 'Not verified line.']);
  });

  it('a null storage (e.g. localStorage access itself threw) is safe throughout', () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: null,
      lines: fakeLines,
    });

    assert.equal(guidance.isOn(), false);
    assert.doesNotThrow(() => guidance.turnOn());
    assert.equal(guidance.isOn(), true);
    assert.doesNotThrow(() => guidance.say('opening'));
    assert.doesNotThrow(() => guidance.turnOff());
  });

  it('replay speaks the intro then the last status line, without cancelling in between', () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    guidance.turnOn();
    guidance.say('checking'); // sets lastKey to 'checking'
    const cancelCountBeforeReplay = speech.cancelCount;

    guidance.replay();

    // replay() cancels once up front (to clear anything mid-speech), then
    // queues both lines without cancelling again in between.
    assert.equal(speech.cancelCount, cancelCountBeforeReplay + 1);
    const spokenTexts = speech.spoken.slice(-2).map((utterance) => utterance.text);
    assert.deepEqual(spokenTexts, ['Intro line.', 'Checking line.']);
  });

  it('replay speaks only the intro when nothing has been announced yet', () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    guidance.turnOn();
    guidance.replay();

    assert.equal(speech.spoken.length, 1);
    assert.equal(speech.spoken[0].text, 'Intro line.');
  });

  it('turnOff cancels speech', () => {
    const speech = createFakeSpeech();
    const guidance = VoiceGuidance.create({
      speech,
      Utterance: FakeUtterance,
      storage: createFakeStorage(),
      lines: fakeLines,
    });
    guidance.turnOn();
    guidance.say('opening');
    const cancelCountBefore = speech.cancelCount;

    guidance.turnOff();
    assert.equal(guidance.isOn(), false);
    assert.equal(speech.cancelCount, cancelCountBefore + 1);
  });

  it('supported() is false with no speech object, and every method is then a safe no-op', async () => {
    const guidance = VoiceGuidance.create({
      speech: undefined,
      Utterance: undefined,
      storage: createFakeStorage(),
      lines: fakeLines,
    });

    assert.equal(guidance.supported(), false);
    assert.doesNotThrow(() => guidance.turnOn());
    assert.doesNotThrow(() => guidance.say('opening'));
    assert.doesNotThrow(() => guidance.stop());
    assert.doesNotThrow(() => guidance.replay());
    await assert.doesNotReject(() => guidance.sayAndWait('opening', 10));
  });
});
