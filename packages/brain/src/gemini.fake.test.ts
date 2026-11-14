import { describe, expect, it } from 'vitest';
import { createFakeGenai, type GenerateParams } from './gemini.fake.js';

const params: GenerateParams = {
  model: 'm',
  contents: 'q',
  config: { systemInstruction: 's', maxOutputTokens: 300, temperature: 0.3 },
};

describe('Fake_Genai_SDK', () => {
  it('records keys and generateContent arguments', async () => {
    const fake = createFakeGenai([{ text: 'hi' }]);
    const ai = fake.factory('test-key-123');
    expect(await ai.models.generateContent(params)).toEqual({ text: 'hi' });
    expect(fake.keys).toEqual(['test-key-123']);
    expect(fake.calls).toEqual([params]);
  });

  it('consumes steps in order and repeats the last one', async () => {
    const fake = createFakeGenai([{ text: 'a' }, { response: { text: 7 } }]);
    const ai = fake.factory('k');
    const texts: unknown[] = [];
    for (let i = 0; i < 3; i += 1) texts.push((await ai.models.generateContent(params)).text);
    expect(texts).toEqual(['a', 7, 7]);
  });

  it('resolves empty text when no steps are given', async () => {
    const ai = createFakeGenai().factory('k');
    expect(await ai.models.generateContent(params)).toEqual({ text: '' });
  });

  it('throws an error with the scripted fields', async () => {
    const fake = createFakeGenai([
      { error: { status: 429, name: 'ApiError', code: 'X', message: 'RESOURCE_EXHAUSTED' } },
    ]);
    const call = fake.factory('k').models.generateContent(params);
    await expect(call).rejects.toMatchObject({
      status: 429,
      name: 'ApiError',
      code: 'X',
      message: 'RESOURCE_EXHAUSTED',
    });
  });
});
