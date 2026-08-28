/**
 * 一键发布到 GitHub Pages（跨平台 Node 脚本）
 * 1. 使用 Vite 构建 client 生产静态文件（相对路径 base=./）
 * 2. 将 dist 部署到 GitHub origin 的 gh-pages 分支
 */
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const repoUrl = 'https://github.com/mmuu1987/dashline.git';
const clientDist = path.resolve(process.cwd(), 'apps/client/dist');
const tmpDir = path.join(os.tmpdir(), 'dashline-ghpages-' + Date.now());

function run(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd: cwd || process.cwd(), encoding: 'utf-8', stdio: 'inherit' });
}

async function deploy(): Promise<void> {
  console.log('=== 1. 构建客户端生产包 (Vite) ===');
  run('pnpm --filter @dashline/client exec vite build --base=./');

  console.log(`\n=== 2. 准备临时部署目录: ${tmpDir} ===`);
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });

  // 复制 dist 内容
  fs.cpSync(clientDist, tmpDir, { recursive: true });

  console.log('\n=== 3. 提交并强制推送到 origin/gh-pages ===');
  run('git init -b gh-pages', tmpDir);
  run(`git remote add origin ${repoUrl}`, tmpDir);
  run('git add -A', tmpDir);
  run('git commit -m "deploy: core.7 release with Laser Gate, solver optimization, theme rotation and streak tracking"', tmpDir);
  run('git push origin gh-pages --force', tmpDir);

  // 清理临时目录
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log('\n============================================================');
  console.log('🎉 GitHub Pages 发布成功！');
  console.log('🔗 在线试玩地址: https://mmuu1987.github.io/dashline/');
  console.log('（GitHub CDN 刷新约需 30~60 秒）');
  console.log('============================================================\n');
}

void deploy();

