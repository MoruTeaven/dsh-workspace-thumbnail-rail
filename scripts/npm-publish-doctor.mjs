#!/usr/bin/env node
/**
 * 发布前预检：确认"要发布的 registry"和"手上的凭证"是同一条渠道。
 *
 * 解决的问题：旧命名 DSH_NPM_MORUTEAVEN_* 看不出渠道归属，实际只对
 * registry.npmjs.org 有身份；拿它去打阿里云雲效私有仓库会返回 403
 * （读和写都是 403），而 npm 不会说"你拿错渠道了"，只会给一个含糊的 403。
 *
 * 本脚本在 publish 之前做两件事：
 *   1. 按 registry 的宿主算出应该用哪套 env 凭证，检查是否就位、是否可通
 *   2. 交叉验证：用另一条渠道的凭证打同一个端点，确认两者是独立身份
 *      （如果居然通了，说明凭证归属有误，必须复核）
 *
 * 判定规则按渠道不同（见 npm-channels.mjs 的 probeKind）：
 *   - whoami    ：200 且返回 username 才算通
 *   - metadata  ：200 / 404 都算"有读权限"（404 只是包还不存在），
 *                 401 / 403 算"无权限"，即拿错渠道的典型表现
 *
 * 不打印任何凭证值。
 *
 * 用法：
 *   node scripts/npm-publish-doctor.mjs --registry https://registry.npmjs.org/
 *   node scripts/npm-publish-doctor.mjs    # 从 package.json 的 scope 推断
 *   node scripts/npm-publish-doctor.mjs --channel ALIYUN_PACKAGES
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { CHANNELS, channelForRegistry } from './npm-channels.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { registry: null, channel: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--registry') args.registry = argv[++i];
    else if (argv[i] === '--channel') args.channel = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    '用法: node scripts/npm-publish-doctor.mjs [--registry <url> | --channel <id>]',
    '',
    '  --registry <url>  要发布到的 registry；省略则从 package.json 的 scope 推断',
    '  --channel <id>    直接指定渠道：' + CHANNELS.map((c) => c.id).join(' | '),
    '  -h, --help        显示本帮助',
  ].join('\n');
}

function httpsGet(url, token) {
  return new Promise((resolve) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const req = https.request(url, { headers, timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          /* 非 JSON 响应按纯文本处理 */
        }
        resolve({ status: res.statusCode, body, parsed });
      });
    });
    req.on('error', (e) => resolve({ status: null, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, error: 'timeout' });
    });
    req.end();
  });
}

/** 按渠道的探测规则判定"这套凭证对这个 registry 是否有效" */
function verdict(channel, result) {
  const { status } = result;
  if (status === null) return { ok: false, detail: `网络错误: ${result.error}` };
  if (channel.probeKind === 'whoami') {
    if (status === 200 && result.parsed?.username) {
      return { ok: true, detail: `HTTP 200 (${result.parsed.username})` };
    }
    return { ok: false, detail: `HTTP ${status}` };
  }
  // metadata 探测：404 表示有读权限但包不存在
  if (status === 200) return { ok: true, detail: 'HTTP 200（读到包元数据）' };
  if (status === 404) return { ok: true, detail: 'HTTP 404（有读权限，包尚未发布）' };
  if (status === 401 || status === 403) {
    return { ok: false, detail: `HTTP ${status}（无权限，仓库拒绝）` };
  }
  return { ok: false, detail: `HTTP ${status}` };
}

/**
 * 区分阿里云返回的两种 403 —— 这是当初排查成本最高的一点。
 *
 * 同是 403，含义可能完全不同：
 *   无权限  ：响应体里没有任何业务说明，只有通用的 "forbidden by your security policy"
 *   版本冲突：响应体里带 "已存在该版本的制品，不允许被覆盖"
 *
 * 后者说明写权限其实是通的，只是版本号重复了。把这两种情况混为一谈，
 * 就会误判成"凭证不对"，然后一直换 token。
 */
export function classifyAliyun403(body) {
  if (typeof body !== 'string') return 'unknown';
  if (/已存在该版本的制品|already exists|cannot be overwritten/i.test(body)) return 'version-conflict';
  return 'no-permission';
}


/** 从 package.json 名字的 scope 推断 registry（读 ~/.npmrc 的 scope 映射） */
function detectFromScope() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scope = pkg.name.startsWith('@') ? pkg.name.slice(0, pkg.name.indexOf('/')) : null;
  if (!scope) return { registry: null, scope: null, source: 'package.json 无 scope' };
  const npmrc = path.join(process.env.USERPROFILE || process.env.HOME || '', '.npmrc');
  let registry = null;
  if (fs.existsSync(npmrc)) {
    const line = fs
      .readFileSync(npmrc, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith(`${scope}:registry=`));
    if (line) registry = line.slice(line.indexOf('=') + 1).trim();
  }
  return {
    registry,
    scope,
    source: registry ? `package.json scope ${scope} 的 ~/.npmrc 映射` : `~/.npmrc 里没有 ${scope}:registry`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  let channel = null;
  let registry = args.registry;
  let source = '--registry 参数';

  if (args.channel) {
    channel = CHANNELS.find((c) => c.id === args.channel);
    if (!channel) {
      console.error(`未知渠道: ${args.channel}`);
      console.error(`可选: ${CHANNELS.map((c) => c.id).join(', ')}`);
      return 1;
    }
    registry = channel.registry;
    source = '--channel 参数';
  }

  if (!channel) {
    if (!registry) {
      const detected = detectFromScope();
      registry = detected.registry;
      source = detected.source;
      if (!registry) {
        console.error('无法推断 registry：请显式传 --registry <url> 或 --channel <id>');
        return 1;
      }
    }
    channel = channelForRegistry(registry);
  }

  console.log(`目标 registry: ${registry}`);
  console.log(`推断来源:      ${source}`);
  console.log('');

  if (!channel) {
    console.error('这条 registry 不在渠道表里，无法判断该用哪套凭证。');
    console.error('已知渠道：');
    for (const c of CHANNELS) console.error(`  ${c.host}  ->  ${c.envPrefix}_ID / ${c.envPrefix}_KEY`);
    return 1;
  }

  console.log(`应该用这套凭证: ${channel.envPrefix}_ID / ${channel.envPrefix}_KEY`);
  console.log(`  ${channel.label}`);
  console.log(`  ${channel.purpose}`);
  console.log('');

  const idName = `${channel.envPrefix}_ID`;
  const keyName = `${channel.envPrefix}_KEY`;
  const token = process.env[keyName];
  const id = process.env[idName];

  console.log('== 第 1 步：当前渠道凭证是否就位 ==');
  console.log(`  ${idName}: ${id ? '已注入' : '未注入'}`);
  console.log(`  ${keyName}: ${token ? '已注入' : '未注入'}`);
  if (!token) {
    console.log('');
    console.log(`判定: 拿不到 ${keyName}，无法预检。`);
    console.log(`提示: ${channel.wrongChannelHint}`);
    return 1;
  }

  const res = await httpsGet(channel.probeUrl, token);
  const v = verdict(channel, res);
  console.log(`  探测 -> ${v.detail}`);
  console.log('');

  console.log('== 第 2 步：交叉验证另一条渠道的凭证确实打不通这里 ==');
  for (const other of CHANNELS) {
    if (other === channel) continue;
    const otherToken = process.env[`${other.envPrefix}_KEY`];
    if (!otherToken) {
      console.log(`  ${other.envPrefix}_KEY 未注入，跳过交叉验证`);
      continue;
    }
    const r2 = await httpsGet(channel.probeUrl, otherToken);
    const v2 = verdict(channel, r2);
    console.log(
      `  用 ${other.label} 的凭证打本 registry -> ${v2.detail}` +
        (v2.ok ? '  [异常: 两组凭证居然通用，请复核归属]' : '  [符合预期: 两套是独立身份]'),
    );
  }
  console.log('');

  if (v.ok) {
    console.log('判定: 通过 —— 当前 registry 与当前凭证属同一渠道，可以发布。');
    return 0;
  }
  console.log('判定: 不通过 —— 凭证对该 registry 无权限，先确认有没有拿错渠道。');
  console.log(`提示: ${channel.wrongChannelHint}`);
  return 1;
}

main().then((code) => process.exit(code));
