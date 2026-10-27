/**
 * npm 发布渠道与凭证命名的唯一真相源。
 *
 * 背景：名为 MORUTEAVEN 的那对凭证实际只对 registry.npmjs.org 有身份，
 * 打到阿里云雲效私有仓库会返回 403（读和写都是 403），排查成本高。
 * 阿里云雲效侧是另一套独立的仓库级账号凭证。
 *
 * 因此两套凭证在 key_panel 里必须按渠道分开命名，变量名本身就要能看出归属渠道。
 *
 * 本模块只描述"命名与渠道的对应关系"，不保存任何凭证值。
 */

export const CHANNELS = [
  {
    /** key_panel 的 account identifier（platform/identifier） */
    id: 'NPMJS_ORG_MORUTEAVEN',
    /** key_panel platform 段 */
    platform: 'NPM',
    /** key_panel account 全名 */
    account: 'NPM/NPMJS_ORG_MORUTEAVEN',
    /** 注入到 shell 的环境变量名前缀（脚本用 ID / KEY 两个字段） */
    envPrefix: 'DSH_NPM_NPMJS_ORG_MORUTEAVEN',
    label: 'npmjs.org · MoruTeaven',
    registry: 'https://registry.npmjs.org/',
    /** 与 registry 对应的宿主，用于预检时判断凭证有没有拿错 */
    host: 'registry.npmjs.org',
    /**
     * 探测端点。npmjs.org 实现了 whoami，直接返回 username。
     * probeKind = 'whoami' 时：200 且带 username 才算通。
     */
    probeUrl: 'https://registry.npmjs.org/-/whoami',
    probeKind: 'whoami',
    purpose: '公开发版到 npmjs.org（@moruteaven 公共包）',
    /** 该渠道只能打这个 registry，打到别的仓库必然 403 */
    wrongChannelHint: '这套凭证只对 npmjs.org 有身份，打到阿里云雲效会 403（读和写都是 403）。',
  },
  {
    id: 'ALIYUN_PACKAGES',
    platform: 'NPM',
    account: 'NPM/ALIYUN_PACKAGES',
    envPrefix: 'DSH_NPM_ALIYUN_PACKAGES',
    label: '阿里云雲效 · packages.aliyun.com',
    registry: 'https://packages.aliyun.com/631c7575050e9c4a07a99328/npm/',
    host: 'packages.aliyun.com',
    /**
     * 阿里云没有可靠的 whoami 端点（/-/whoami 对无权限 token 与有效 token
     * 都可能回 403，不能用来判权），所以改用"读一个已知包的元数据"来判权：
     *   200 / 404 -> 凭证对该仓库有读权限（404 只是包不存在）
     *   401 / 403 -> 凭证对该仓库无权限（拿错渠道的典型表现）
     * probeKind = 'metadata' 时按上面这套规则判定。
     */
    probeUrl:
      'https://packages.aliyun.com/631c7575050e9c4a07a99328/npm/dsh-workspace-thumbnail-rail/@moruteaven%2fdsh-workspace-thumbnail-rail',
    probeKind: 'metadata',
    purpose: '私域发版到阿里云雲效（dev 版、私有渠道包）',
    wrongChannelHint: '这套凭证只对阿里云雲效对应仓库有身份，打到 npmjs.org 会 ENEEDAUTH。',
  },
];

/** 已废弃的旧命名：曾经同时被当成两套渠道在用，是本次 403 的直接来源 */
export const DEPRECATED = [
  {
    id: 'MORUTEAVEN',
    platform: 'NPM',
    account: 'NPM/MORUTEAVEN',
    envPrefix: 'DSH_NPM_MORUTEAVEN',
    replacedBy: 'NPM/NPMJS_ORG_MORUTEAVEN',
    // replacedBy 指向 CHANNELS 里的 id（即 key_panel account 的 identifier 段）
    replacedBy: 'NPMJS_ORG_MORUTEAVEN',
    reason:
      '旧命名看不出归属渠道，实际只对 npmjs.org 有身份；误拿去打阿里云雲效会 403。已按渠道拆分为 NPM/NPMJS_ORG_MORUTEAVEN 与 NPM/ALIYUN_PACKAGES。',
  },
];

/** 旧 env 变量名 -> 新 env 变量名（ID / KEY 两档） */
export function deprecatedEnvMap() {
  const map = new Map();
  for (const d of DEPRECATED) {
    const target = CHANNELS.find((c) => c.id === d.replacedBy);
    if (!target) continue;
    map.set(`${d.envPrefix}_ID`, `${target.envPrefix}_ID`);
    map.set(`${d.envPrefix}_KEY`, `${target.envPrefix}_KEY`);
  }
  return map;
}

/** 按 host 反查渠道，用于预检"当前 registry 该用哪套凭证" */
export function channelForRegistry(registry) {
  if (!registry) return null;
  let host;
  try {
    host = new URL(registry).host;
  } catch {
    return null;
  }
  return CHANNELS.find((c) => host === c.host) ?? null;
}

/** 按 env 变量名反查渠道 */
export function channelForEnv(name) {
  return CHANNELS.find((c) => name === `${c.envPrefix}_ID` || name === `${c.envPrefix}_KEY`) ?? null;
}
