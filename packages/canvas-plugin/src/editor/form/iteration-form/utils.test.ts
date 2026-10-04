import { IterationFormSchema } from './schema';
import {
  convertIterationOutputsToArray,
  convertIterationOutputsToObject,
} from './utils';

describe('iteration output references', () => {
  const outputRef = 'Invoke:HTTP_Request_0@result';

  it('keeps an HTTP output ref during form validation', () => {
    const parsed = IterationFormSchema.parse({
      items_ref: 'begin@files',
      outputs: [
        {
          name: 'result',
          ref: outputRef,
          type: 'Array<string>',
        },
      ],
    });

    expect(parsed.outputs?.[0]).toEqual({
      name: 'result',
      ref: outputRef,
      type: 'Array<string>',
    });
  });

  it('keeps an HTTP output ref after save and reload conversion', () => {
    const saved = convertIterationOutputsToObject([
      { name: 'result', ref: outputRef, type: 'Array<string>' },
    ]);
    const reloaded = convertIterationOutputsToArray(saved);

    expect(saved).toEqual({
      result: { ref: outputRef, type: 'Array<string>' },
    });
    expect(reloaded).toEqual([
      { name: 'result', ref: outputRef, type: 'Array<string>' },
    ]);
  });

  it('does not persist unfinished output rows', () => {
    expect(
      convertIterationOutputsToObject([
        { name: '', ref: outputRef, type: 'Array<string>' },
      ]),
    ).toEqual({});
  });
});
