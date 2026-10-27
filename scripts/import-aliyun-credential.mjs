#!/usr/bin/env node
/**
 * 把本机 ~/.npmrc 里已经在用的阿里云雲效凭证，录入 key_panel 的
 * NPM/ALIYUN_PACKAGES 槽位，让两套渠道的凭证在面板里真正成对存在。
 *
 * 背景：只给阿里云建一个空 account 是不够的——发布时要么还是翻 ~/.npmrc，
 * 要么又回到"手边有什么 token 就用什么"的老路。凭证必须在面板里可见、
 * 有名字、有说明，才能做到"一眼选对"。
 *
 * 从 ~/.npmrc 取什么：
 *   - `//packages.aliyun.com/<组织ID>/npm/<仓库>/:_authToken=`  -> 访问令牌（key 槽位）
 *   - `//packages.aliyun.com/<组织ID>/npm/<仓库>/:_auth=`       -> base64(user:pass)，只取用户名（id 槽位）
 *
 * 特性：
 *   - 默认 dry-run；--write 才落盘，落盘前自动备份 keys.json
 *   - 已存在则不覆盖（幂等），除非显式 --force
 *   - 绝不打印任何凭证值，只报长度
 *   - 写入的 origin 标记为 operator：这是 operator 的凭证，模型不应能改它
 *
 * 用法：
 *   node scripts/import-aliyun-credential.mjs            # 看会写入什么
 *   node scripts/import-aliyun-credential.mjs --write    # 真正写入
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CHANNELS } from './npm-channels.mjs';

const DEFAULT_KEYS = path.join(os.homedir(), '.dsh', 'key-panel', 'keys.json');
const NPMRC = path.join(os.homedir(), '.npmrc');

const CHANNEL = CHANNELS.find((c) => c.id === 'ALIYUN_PACKAGES');

function parseArgs(argv) {
  const args = { keys: DEFAULT_KEYS, write: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keys') args.keys = argv[++i];
    else if (argv[i] === '--write') args.write = true;
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    '用法: node scripts/import-aliyun-credential.mjs [--keys <path>] [--write] [--force]',
    '',
    '  --keys <path>  keys.json 路径（默认 ~/.dsh/key-panel/keys.json）',
    '  --write        真正写入；默认只打印将要写入什么',
    '  --force        覆盖已存在的同名条目（默认跳过）',
    '  -h, --help     显示本帮助',
  ].join('\n');
}

/** 从 ~/.npmrc 读出阿里云凭证；返回 { token, username, repo } */
function readAliyunCredential() {
  if (!fs.existsSync(NPMRC)) throw new Error(`找不到 ${NPMRC}`);
  const lines = fs.readFileSync(NPMRC, 'utf8').split(/\r?\n/);

  let token = null;
  let username = null;
  let repo = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('//packages.aliyun.com')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');

    const m = key.match(/^\/\/packages\.aliyun\.com\/[^/]+\/npm\/([^/]+)\/(?::_auth|:_authToken)$/);
    if (!m) continue;
    const thisRepo = m[1];

    if (key.endsWith(':_authToken')) {
      token = value;
      repo = thisRepo;
    } else if (key.endsWith(':_auth')) {
      // base64(user:password) —— 只要用户名
      try {
        const decoded = Buffer.from(value, 'base64').toString('utf8');
        username = decoded.slice(0, decoded.indexOf(':'));
      } catch {
        /* 解不开就留给 token 那一路 */
      }
    }
  }

  return { token, username, repo };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  let cred;
  try {
    cred = readAliyunCredential();
  } catch (e) {
    console.error(`读取 ${NPMRC} 失败: ${e.message}`);
    return 1;
  }

  console.log(`来源: ${NPMRC}`);
  console.log(`渠道: ${CHANNEL.label}`);
  console.log('');
  console.log('== 从 ~/.npmrc 读到的内容 ==');
  console.log(`  访问令牌(_authToken): ${cred.token ? `已找到（长度 ${cred.token.length}）` : '未找到'}`);
  console.log(`  用户名(_auth 解码):   ${cred.username ? `${cred.username}` : '未找到'}`);
  console.log(`  关联仓库:             ${cred.repo ?? '未知'}`);
  console.log('');

  if (!cred.token) {
    console.error('~/.npmrc 里没有 packages.aliyun.com 的 _authToken，无法导入。');
    console.error('请先在阿里云雲效控制台复制访问令牌，配置到 ~/.npmrc 后再跑本脚本。');
    return 1;
  }

  if (!fs.existsSync(args.keys)) {
    console.error(`找不到 keys.json: ${args.keys}`);
    return 1;
  }

  const data = JSON.parse(fs.readFileSync(args.keys, 'utf8'));
  const keys = data.keys ?? {};
  const accounts = data.accounts ?? {};

  // 前置条件：account 必须先存在，否则 key 会变成无归属的孤儿
  if (!accounts[CHANNEL.account]) {
    console.error(`缺少 account ${CHANNEL.account}。先跑 scripts/rename-npm-credentials.mjs --write 建好分组。`);
    return 1;
  }

  const idName = `${CHANNEL.envPrefix}_ID`;
  const keyName = `${CHANNEL.envPrefix}_KEY`;
  const now = Date.now();

  const plan = [];
  if (cred.username) {
    plan.push({ name: idName, field: 'id', value: cred.username, what: '用户名' });
  } else {
    console.log(`跳过 ${idName}：~/.npmrc 里没有可解码的用户名（不是错误，只是这一档缺）`);
  }
  plan.push({ name: keyName, field: 'key', value: cred.token, what: '访问令牌' });
  console.log('');

  const writes = [];
  for (const item of plan) {
    if (Object.hasOwn(keys, item.name) && !args.force) {
      console.log(`跳过 ${item.name}：已存在（要覆盖加 --force）`);
      continue;
    }
    writes.push(item);
  }

  if (writes.length === 0) {
    console.log('没有需要写入的条目，幂等退出。');
    return 0;
  }

  console.log('== 将要写入 ==');
  for (const w of writes) {
    console.log(`  ${w.name}  (${w.what}，长度 ${w.value.length})`);
  }
  console.log('');
  console.log(`说明文字会写成：「${CHANNEL.label} 的${'用户名/访问令牌'}｜${CHANNEL.purpose}｜注意：${CHANNEL.wrongChannelHint}」`);
  console.log('');

  if (!args.write) {
    console.log('dry-run 结束，未修改任何文件（加 --write 才落盘）。');
    return 0;
  }

  for (const w of writes) {
    keys[w.name] = {
      value: w.value,
      description: `${CHANNEL.label} 的${w.what}｜${CHANNEL.purpose}｜注意：${CHANNEL.wrongChannelHint}`,
      // operator 的凭证，标记为 operator，模型（即便提到写权限）也不应改动它
      origin: 'operator',
      platform: CHANNEL.platform,
      account: CHANNEL.id,
      field: w.field,
      createdAt: now,
      updatedAt: now,
    };
  }

  const backup = `${args.keys}.bak-${now}`;
  fs.copyFileSync(args.keys, backup);
  console.log(`已备份: ${backup}`);

  fs.writeFileSync(
    args.keys,
    JSON.stringify({ ...data, keys, accounts }, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  );
  console.log(`已写入: ${args.keys}`);
  console.log('');
  console.log('新变量在下一个会话注入后生效，当前会话仍是旧变量。');
  return 0;
}

process.exit(main());
