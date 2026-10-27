# npm 发布凭证：按渠道分开命名

本项目的包要发到**两个完全独立的 npm 仓库**，两边是两套互不通用的身份。拿错凭证时，
npm 只会给一个含糊的 `403`，不会告诉你"你拿错渠道了"——这是本项目踩过的真实坑，
排查花了不少时间。本文记录命名规则与发布前预检方法。

## 两套渠道

| 渠道 | registry | 用途 | 凭证环境变量 |
| --- | --- | --- | --- |
| **npmjs.org** | `https://registry.npmjs.org/` | 公开发版（正式版） | `DSH_NPM_NPMJS_ORG_MORUTEAVEN_ID` / `_KEY` |
| **阿里云雲效** | `https://packages.aliyun.com/<组织ID>/npm/<仓库名>/` | 私域发版（dev 版、私有渠道包） | `DSH_NPM_ALIYUN_PACKAGES_ID` / `_KEY` |

渠道与变量名的对应关系写在 [`scripts/npm-channels.mjs`](../scripts/npm-channels.mjs)，
它是唯一真相源；脚本和文档都从那里取，不要在别处硬编码变量名。

## 命名规则

变量名里必须能一眼看出**归属渠道**：

- `DSH_NPM_NPMJS_ORG_*` —— 开头就是 `npmjs_org`，只对 npmjs.org 有身份
- `DSH_NPM_ALIYUN_PACKAGES_*` —— 开头就是 `aliyun_packages`，只对阿里云雲效有身份

**不要**再用 `DSH_NPM_MORUTEAVEN_*` 这类看不出渠道的名字。它曾同时被当成两边的凭证在用，
结果是：拿它去打阿里云雲效私有仓库，读和写都返回 403；换个仓库级账号才通。

### 旧命名的处置

`NPM/MORUTEAVEN`（env `DSH_NPM_MORUTEAVEN_*`）**已弃用**，其值实为 npmjs.org 侧身份，
现已并入 `NPM/NPMJS_ORG_MORUTEAVEN`。迁移分两步完成：

```bash
# 1. 旧命名按渠道拆分（dry-run 先看，再 --write 落盘，自动备份、幂等）
node scripts/rename-npm-credentials.mjs
node scripts/rename-npm-credentials.mjs --write

# 2. 把 ~/.npmrc 里在用的阿里云凭证录入面板的 ALIYUN_PACKAGES 槽位
#    （只建空 account 不够用，凭证必须在面板里成对可见才算"能一眼选对"）
node scripts/import-aliyun-credential.mjs
node scripts/import-aliyun-credential.mjs --write
```

两个脚本都只改变量名/分组/说明，**凭证值原样保留**，且幂等，可以反复执行。
改名后新变量在**下一个会话**才注入，当前会话仍持有旧变量名——这是 key_panel 的注入时机决定的。

## 发布前预检（务必跑）

```bash
# 直接指定渠道
pnpm run npm:doctor -- --channel NPMJS_ORG_MORUTEAVEN
pnpm run npm:doctor -- --channel ALIYUN_PACKAGES

# 或按 registry 判断该用哪套
pnpm run npm:doctor -- --registry https://registry.npmjs.org/
```

预检会做两件事：

1. **该用的凭证是否就位、是否打得通**——按渠道用不同的判定规则（见下）
2. **交叉验证**——拿另一条渠道的凭证打同一个端点。如果居然也通了，说明凭证归属有误，必须复核

两条渠道的探测方式不同，因为能力不同：

- npmjs.org 有可靠的 `/-/whoami`，返回 `200` + 用户名才算通
- 阿里云没有可靠的 whoami 端点，改用「读一个已知包的元数据」判权：
  `200` / `404`（包不存在）都算**有读权限**，`401` / `403` 才算**无权限**

## 关于阿里云的 403：两种含义必须分开看

这是当初最容易误判的地方。同样是 `403`，响应内容完全不同：

| 响应内容 | 含义 | 该怎么办 |
| --- | --- | --- |
| `仓库中已存在该版本的制品，不允许被覆盖` | **权限是通的**，只是版本号重复 | 改版本号，别换凭证 |
| 只有通用的 `forbidden by your security policy` | 真的无权访问 | 检查是不是拿错渠道了 |

第一类尤其容易误判成"token 不对"，然后一直换 token 却始终不通。

## 发布

```bash
# 相应用户级 ~/.npmrc 或临时 npmrc 指向目标 registry，并配好对应渠道的 _authToken
pnpm run npm:doctor -- --channel ALIYUN_PACKAGES   # 先预检
npm publish                                         # 再发布
```

版本策略：正式版才发 npmjs.org；dev 版等非正式版只走私域渠道（见项目根 AGENTS/发布约定）。

## 相关文件

- [`scripts/npm-channels.mjs`](../scripts/npm-channels.mjs) —— 渠道与命名的唯一真相源
- [`scripts/rename-npm-credentials.mjs`](../scripts/rename-npm-credentials.mjs) —— 旧命名按渠道拆分（dry-run 默认）
- [`scripts/import-aliyun-credential.mjs`](../scripts/import-aliyun-credential.mjs) —— 从 `~/.npmrc` 录入阿里云凭证（dry-run 默认）
- [`scripts/npm-publish-doctor.mjs`](../scripts/npm-publish-doctor.mjs) —— 发布前预检

## 实测验证矩阵

用新命名的两组变量逐一互打，确认它们确实是两套独立身份（这张表就是"拿错会 403"的证据）：

| 用哪套凭证 | 打 npmjs.org `/-/whoami` | 打阿里云仓库包元数据 |
| --- | --- | --- |
| `DSH_NPM_NPMJS_ORG_MORUTEAVEN_KEY` | **200** `{"username":"moruteaven"}` | **403**（无权限） |
| `DSH_NPM_ALIYUN_PACKAGES_KEY` | **401**（未认证） | **200**（读到元数据） |

阿里云侧的写权限已用真实 `npm publish` 探测过：新命名的阿里云凭证能走到「版本已存在」这一步，
说明权限本身是通的（详见上文两种 403 的区别）。
