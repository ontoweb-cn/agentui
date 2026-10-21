import { isSlashCommandVisible, parseSlashCommand } from './command';

describe('parseSlashCommand', () => {
  it('解析裸命令名', () => {
    expect(parseSlashCommand('/retry')).toEqual({
      commandName: 'retry',
      arg: '',
    });
  });

  it('解析命令名与参数', () => {
    expect(parseSlashCommand('/model deepseek-flash')).toEqual({
      commandName: 'model',
      arg: 'deepseek-flash',
    });
  });

  it('允许 / 后空格', () => {
    expect(parseSlashCommand('/ model')).toEqual({
      commandName: 'model',
      arg: '',
    });
  });

  it('非命令文本返回 null', () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
  });
});

describe('isSlashCommandVisible', () => {
  it('裸 / 显示全量命令面板', () => {
    expect(isSlashCommandVisible('/')).toBe(true);
    expect(isSlashCommandVisible('/ ')).toBe(true);
  });

  it('命令前缀与参数均显示面板', () => {
    expect(isSlashCommandVisible('/r')).toBe(true);
    expect(isSlashCommandVisible('/retry')).toBe(true);
    expect(isSlashCommandVisible('/model deepseek-flash')).toBe(true);
  });

  it('非命令文本不显示面板', () => {
    expect(isSlashCommandVisible('')).toBe(false);
    expect(isSlashCommandVisible('hello')).toBe(false);
    expect(isSlashCommandVisible('hello /retry')).toBe(false);
  });
});
