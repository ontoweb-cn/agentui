import { OutputArray, OutputObject } from './interface';

export function convertIterationOutputsToArray(
  outputs: OutputObject | OutputArray | undefined,
): OutputArray {
  if (Array.isArray(outputs)) {
    return outputs.map((output) => ({ ...output }));
  }

  return Object.entries(outputs ?? {}).map(([name, output]) => ({
    name,
    ref: output.ref,
    type: output.type,
  }));
}

export function convertIterationOutputsToObject(
  outputs: OutputArray | undefined,
): OutputObject {
  return (outputs ?? []).reduce<OutputObject>((next, output) => {
    if (output.name) {
      next[output.name] = { ref: output.ref, type: output.type };
    }
    return next;
  }, {});
}
