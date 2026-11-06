# 上架清单 / Store List

DSH（DeepSeek Harness）没有官方插件市场。所谓「商店」是第三方维护的**插件市场索引源**：一个公开的 JSON 文件，用户在 DSH 的「插件 → 发现」里把它**添加为索引源**，即可看到并一键安装其中的插件。

本仓库已发布的安装来源：

- **npmjs.org（公开）**：`@moruteaven/dsh-workspace-thumbnail-rail@1.0.0`，这是真正的安装包来源。
- **自建索引源**：[`docs/plugin-market-index.json`](https://github.com/MoruTeaven/dsh-workspace-thumbnail-rail/blob/master/docs/plugin-market-index.json)，已用 DSH 官方 `parseMarketIndex` 校验通过。索引源 URL：

  ```
  https://raw.githubusercontent.com/MoruTeaven/dsh-workspace-thumbnail-rail/master/docs/plugin-market-index.json
  ```

---

## 主流第三方索引（社区「商店」）

| 名称 | 规模 | 收录方式 | 上架动作 | 提交入口 |
| --- | --- | --- | --- | --- |
| **Open Plugin Market**（dshopen.org） | 最大、最主流，数百插件 | 手动提交 Issue | 开 `plugin-add` Issue，填 npm 包名 + 一句话说明 | https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml |
| **dsh.so / DSH Marketplace** | 25,509 个插件 | **自动从 GitHub `dsh-plugin` topic 抓取** | 给本仓库打 `dsh-plugin` topic 标签 | https://www.dsh.so/ |
| **dsh-plugin-catalog**（awesome-dsh-plugin.com / dshmarket.com） | 通过 npm 包分发 `index.json` | 大概率自动 / topic 抓取 | 给本仓库打 `dsh-plugin` topic 标签 | https://github.com/dsh-market/dsh-market |
| **AllDSH**（alldsh.com） | 编辑维护，带验证级别与安全状态 | 编辑收录 | 联系维护者 / 等待收录 | https://alldsh.com/ |
| **DSHSeek**（dshseek.com） | 29 个，人工审核 | 编辑审核 | 联系维护者 | https://dshseek.com/market/ |

> 个人自建索引（如 `Silentforfar/dsh-market-index`）只列作者自己的插件，不收录外部提交，不在上架目标内。

---

## 必做项（一次性，覆盖两大自动索引）

**给本 GitHub 仓库打 `dsh-plugin` topic 标签**（在仓库页面右侧 Topics 处添加）：
`dsh-plugin`、`deepseek-harness`、`dsh`、`plugin`

这一步让 dsh.so 与 dsh-plugin-catalog 等自动索引能发现并收录本插件。需要你在 GitHub 网页操作（机器人无认证 API 权限）。

---

## Open Plugin Market 提交模板（预填）

去 https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml 提交，内容可直接复制：

- **插件地址 / Plugin link**：`@moruteaven/dsh-workspace-thumbnail-rail`
- **简短说明 / Summary**：为 DeepSeek Harness 的每个工作区设置缩略图，并在侧栏与对话区之间加一条竖排工作区导航栏，点击即可切换工作区。
- **补充信息 / Additional details**：已发布 npm `1.0.0`（MIT 许可），源码仓库 https://github.com/MoruTeaven/dsh-workspace-thumbnail-rail；图标见仓库 `docs/assets/plugin-icon.svg`。

---

## 版本更新时

每发一个新版本，更新本仓库 [`docs/plugin-market-index.json`](https://github.com/MoruTeaven/dsh-workspace-thumbnail-rail/blob/master/docs/plugin-market-index.json) 的 `versions[]`（新增一条带 `publishTimestamp` 与 npm registry 的记录），重新校验并提交即可。自动索引按 topic 周期刷新；手动索引（Open Plugin Market）通常无需重复提交，若版本未自动同步可更新原 Issue。
