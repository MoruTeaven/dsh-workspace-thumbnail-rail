#!/usr/bin/env node
/**
 * 把 key_panel 里一套"看不出渠道"的 npm 凭证，按渠道拆成两套分开命名。
 *
 * 解决的问题：旧命名 NPM/MORUTEAVEN（env: DSH_NPM_MORUTEAVEN_ID / _KEY）
 * 实际只对 registry.npmjs.org 有身份，但名字里没有任何渠道信息，
 * 发布时很容易被拿到阿里云雲效私有仓库上，返回 403（读和写都是 403），
 * 且错误不明确，排查成本高。
 *
 * 本脚本做的事情：
 *   1. 把 NPM/MORUTEAVEN 重命名为 NPM/NPMJS_ORG_MORUTEAVEN（名字里写明 npmjs.org）
 *   2. 同步把 env 变量改成 DSH_NPM_NPMJS_ORG_MORUTEAVEN_ID / _KEY
 *   3. 保留一条 NPM/ALIYUN_PACKAGES（env: DSH_NPM_ALIYUN_PACKAGES_ID / _KEY）作为
 *      阿里云雲效侧的独立身份占位，避免再有人按 npmjs 身份去打阿里云
 *   4. 给每条凭证写清用途与"拿错的后果"
 *
 * 特性：
 *   - 默认 dry-run，只打印将要发生的变更，不落盘
 *   - --write 才写，且写前先备份 keys.json 到同目录
 *   - 幂等：已经迁移过的文件再跑一次不会重复改
 *   - 只改名和描述，绝不搬运或打印任何凭证值
 *
 * 用法：
 *   node scripts/rename-npm-credentials.mjs                          # dry-run，读默认路径
 *   node scripts/rename-npm-credentials.mjs --keys <path>             # 对副本试跑
 *   node scripts/rename-npm-credentials.mjs --write                   # 真正写入（需对该文件有写权限）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CHANNELS, DEPRECATED, deprecatedEnvMap } from './npm-channels.mjs';

const DEFAULT_KEYS = path.join(os.homedir(), '.dsh', 'key-panel', 'keys.json');

function parseArgs(argv) {
  const args = { keys: DEFAULT_KEYS, write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keys') args.keys = argv[++i];
    else if (argv[i] === '--write') args.write = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    '用法: node scripts/rename-npm-credentials.mjs [--keys <path>] [--write]',
    '',
    '  --keys <path>  key_panel 的 keys.json 路径（默认 ~/.dsh/key-panel/keys.json）',
    '  --write        真正写入；默认只打印将要发生的变更',
    '  -h, --help     显示本帮助',
  ].join('\n');
}

/** 一条凭证在改名后的目标形态 */
function targetFor(existingKeyName, key) {
  // 先判断是否属于被废弃的旧命名。
  // keys 段里 account 存的是短 identifier（如 MORUTEAVEN），
  // accounts 段里存的才是全名（如 NPM/MORUTEAVEN），两种都要认。
  if (key.platform === 'NPM') {
    const hit = DEPRECATED.find((d) => d.id === key.account || d.account === key.account);
    if (hit) {
      const target = CHANNELS.find((c) => c.id === hit.replacedBy);
      if (target) return { channel: target, field: key.field };
    }
  }
  // 已经迁移过的：按 env 前缀反查，保持不动
  const channel = CHANNELS.find((c) => existingKeyName.startsWith(c.envPrefix + '_'));
  if (channel) return { channel, field: key.field };
  return null;
}

function newEnvName(channel, field) {
  return `${channel.envPrefix}_${field === 'id' ? 'ID' : 'KEY'}`;
}

function describe(channel, field) {
  const what = field === 'id' ? '用户名' : '访问令牌';
  return `${channel.label} 的${what}｜${channel.purpose}｜注意：${channel.wrongChannelHint}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  if (!fs.existsSync(args.keys)) {
    console.error(`找不到 keys.json: ${args.keys}`);
    console.error('如果你是想先试跑，先把文件复制一份再用 --keys 指向副本。');
    return 1;
  }

  const raw = fs.readFileSync(args.keys, 'utf8');
  const data = JSON.parse(raw);
  const keys = data.keys ?? {};

  const renames = [];
  const descriptions = [];
  const nextKeys = {};

  for (const [name, key] of Object.entries(keys)) {
    const t = targetFor(name, key);
    if (!t) {
      nextKeys[name] = key;
      continue;
    }
    const nextName = newEnvName(t.channel, key.field);
    if (nextName !== name) renames.push({ from: name, to: nextName });

    const nextDesc = describe(t.channel, key.field);
    const next = {
      ...key,
      account: t.channel.id,
      description: nextDesc,
      updatedAt: Date.now(),
    };

    if (next.description !== key.description) {
      descriptions.push({ name: nextName, before: key.description, after: nextDesc });
    }
    // 后写覆盖先写：改名场景下旧键会被自然丢弃
    nextKeys[nextName] = next;
  }

  // 改名后旧键不应残留（防御：万一同名冲突导致旧键被写入）
  for (const r of renames) delete nextKeys[r.from];

  // accounts 段：改名 + 补上阿里云渠道占位
  const nextAccounts = { ...(data.accounts ?? {}) };
  const accountChanges = [];
  for (const d of DEPRECATED) {
    if (nextAccounts[d.account]) {
      const target = CHANNELS.find((c) => c.id === d.replacedBy);
      const val = { ...nextAccounts[d.account], identifier: target.id, label: target.label };
      delete nextAccounts[d.account];
      nextAccounts[target.account] = val;
      accountChanges.push({ from: d.account, to: target.account, label: target.label });
    }
  }
  const ali = CHANNELS.find((c) => c.id === 'ALIYUN_PACKAGES');
  if (!nextAccounts[ali.account]) {
    nextAccounts[ali.account] = {
      platform: 'NPM',
      identifier: ali.id,
      label: ali.label,
      createdAt: Date.now(),
    };
    accountChanges.push({ from: '(新增占位)', to: ali.account, label: ali.label });
  }

  const changed =
    renames.length > 0 || descriptions.length > 0 || accountChanges.length > 0;

  console.log(`目标文件: ${args.keys}`);
  console.log(`模式:     ${args.write ? '写入' : 'dry-run（加 --write 才会落盘）'}`);
  console.log('');

  if (!changed) {
    console.log('没有需要迁移的项：凭证已经是按渠道分开的新命名，脚本幂等退出。');
    return 0;
  }

  console.log('== 环境变量改名 ==');
  for (const r of renames) console.log(`  ${r.from}  ->  ${r.to}`);
  console.log('');
  console.log('== accounts 段 ==');
  for (const a of accountChanges) console.log(`  ${a.from}  ->  ${a.to}  (${a.label})`);
  console.log('');
  console.log('== 描述更新（写清用途与拿错的后果） ==');
  for (const d of descriptions) console.log(`  ${d.name}`);
  console.log('');
  console.log('== 旧命名处置 ==');
  for (const d of DEPRECATED) {
    const target = CHANNELS.find((c) => c.id === d.replacedBy);
    console.log(`  ${d.envPrefix}_ID / ${d.envPrefix}_KEY 已弃用 -> ${target.envPrefix}_ID / ${target.envPrefix}_KEY`);
    console.log(`    原因: ${d.reason}`);
  }
  console.log('');

  console.log('== 旧 env 名 -> 新 env 名 对照（供脚本/文档批量替换） ==');
  for (const [from, to] of deprecatedEnvMap()) console.log(`  ${from} -> ${to}`);
  console.log('');

  if (!args.write) {
    console.log('dry-run 结束，未修改任何文件。');
    return 0;
  }

  const backup = `${args.keys}.bak-${Date.now()}`;
  fs.copyFileSync(args.keys, backup);
  console.log(`已备份: ${backup}`);

  fs.writeFileSync(
    args.keys,
    JSON.stringify({ ...data, keys: nextKeys, accounts: nextAccounts }, null, 2) + '\n',
    'utf8',
  );
  console.log(`已写入: ${args.keys}`);
  console.log('');
  console.log('注意：改名只影响变量名与说明，凭证值原样保留。');
  console.log('新变量在下一个会话注入后才生效；当前会话仍持有旧变量名。');
  return 0;
}

process.exit(main());
