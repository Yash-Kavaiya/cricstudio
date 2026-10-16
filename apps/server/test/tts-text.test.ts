import { describe, expect, it } from 'vitest';
import { speakable } from '../src/commentary/tts';

describe('speakable (text sent to Edge TTS inside SSML)', () => {
  it('never contains XML-breaking characters', () => {
    for (const s of ['c &dagger;Samson b Singh', 'Kohli c & b Starc', 'need <10 runs', 'A & B > C']) {
      expect(speakable(s)).not.toMatch(/[&<>]/);
    }
  });

  it('reads cricket shorthand naturally', () => {
    expect(speakable('Kohli c & b Starc')).toBe('Kohli caught and bowled Starc');
    expect(speakable('R Powell c †Samson b Arshdeep Singh.')).toBe('R Powell c Samson b Arshdeep Singh.');
    expect(speakable('Rohit Sharma*  58')).toBe('Rohit Sharma 58');
  });
});
