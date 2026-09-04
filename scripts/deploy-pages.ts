/**
 * 将 client 生产静态文件发布到指定 Git 仓库的 gh-pages 分支。
 * 强制覆盖远端分支前必须显式传入 --allow-force。
 */
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

interface Options {
  allowForce: boolean;
  target?: string;
}

function parseOptions(args: string[]): Options {
  const options: Options = { allowForce: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--allow-force') {
      options.allowForce = true;
    } else if (arg === '--target') {
      const target = args[++i];
      if (!target) throw new Error('--target 缺少 Git URL');
      options.target = target;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function run(file: string, args: string[], cwd = process.cwd()): void {
  execFileSync(file, args, { cwd, stdio: 'inherit' });
}

function output(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: 'utf8' }).trim();
}

function validateTarget(target: string): string {
  const value = target.trim();
  if (!value || /[\r\n]/.test(value)) throw new Error('Git 发布目标无效');
  if (!/^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/.test(value)) {
    throw new Error(`不支持的 Git 发布目标：${value}`);
  }
  return value;
}

function deploy(): void {
  const options = parseOptions(process.argv.slice(2));
  if (!options.allowForce) {
    throw new Error(
      '发布会强制覆盖远端 gh-pages；确认目标后使用 pnpm pages:deploy -- --allow-force [--target <git-url>]',
    );
  }

  const target = validateTarget(options.target ?? output('git', ['remote', 'get-url', 'origin']));
  const clientDist = path.resolve(process.cwd(), 'apps/client/dist');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashline-ghpages-'));

  console.log(`发布目标：${target}`);
  try {
    console.log('=== 1. 构建客户端生产包 (Vite) ===');
    if (process.platform === 'win32') {
      run(process.env.ComSpec ?? 'cmd.exe', [
        '/d',
        '/s',
        '/c',
        'pnpm',
        '--filter',
        '@dashline/client',
        'exec',
        'vite',
        'build',
        '--base=./',
      ]);
    } else {
      run('pnpm', ['--filter', '@dashline/client', 'exec', 'vite', 'build', '--base=./']);
    }

    console.log(`=== 2. 准备临时部署目录：${tempDir} ===`);
    fs.cpSync(clientDist, tempDir, { recursive: true });

    console.log('=== 3. 提交并强制推送 gh-pages ===');
    run('git', ['init', '-b', 'gh-pages'], tempDir);
    run('git', ['remote', 'add', 'origin', target], tempDir);
    run('git', ['add', '-A'], tempDir);
    run('git', ['commit', '-m', 'pages: build'], tempDir);
    run('git', ['push', 'origin', 'gh-pages', '--force'], tempDir);
    console.log('GitHub Pages 发布完成。');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  deploy();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
