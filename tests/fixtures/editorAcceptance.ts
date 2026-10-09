const typescriptSource = [
    'class Counter {',
    '  private value = 0;',
    '',
    '  increment(step = 1) {',
    '    const apply = () => {',
    '      this.value += step;',
    '    };',
    '    apply();',
    '    return this.value;',
    '  }',
    '}',
].join('\n');

const insideText = 'this.value += step;';
const crossingStart = typescriptSource.indexOf('const apply');
const crossingEnd = typescriptSource.indexOf('apply();') + 'apply();'.length;

export const editorAcceptanceFixture = {
    typescript: typescriptSource,
    python: [
        'class Counter:',
        '    def increment(self, values):',
        '        total = (',
        '            sum(values)',
        '            + 1',
        '        )',
        '        return total',
    ].join('\n'),
    annotations: {
        insideFold: {
            from: typescriptSource.indexOf(insideText),
            to: typescriptSource.indexOf(insideText) + insideText.length,
        },
        crossingFoldBoundary: {
            from: crossingStart,
            to: crossingEnd,
        },
    },
    largeSource: (lineCount: number = 5000) => Array.from(
        { length: lineCount },
        (_, line) => `const generated_${line} = ${line};`,
    ).join('\n'),
    diff: {
        oldText: 'function value() {\n  return 1;\n}',
        newText: 'function value() {\n  const first = 1;\n  const second = 2;\n  return first + second;\n}',
    },
} as const;
