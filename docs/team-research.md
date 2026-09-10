# 团队组成与 Base 调研

全站人物关系图谱已删除。人物过多、关系过散，不能帮助判断一个项目。团队信息只出现在分析详情里的「团队分析」区块：对本项目做组成、能力与 Base 调研，不把全库人物画成一张图。

## 入口

分析页打开项目详情 →「团队分析」→「深度调研」。打开详情和刷新分析都不会触发外部请求。只有点击后才 POST 入队；GET 只读已保存报告。报告在 `data/research-reports/`。服务重启后的未完成任务标记为中断，需再点一次。

## 展示内容

1. **团队组成**：GitHub 公开贡献者（标注非雇佣认定）与模型从公开材料抽出的成员。角色、简介、公司、工作地、贡献次数。完整 contributor 名单可展开。
2. **团队分析**：开源侧为协作广度、贡献分散、公开仓库积累；创业侧为领域经验、过往交付、职能互补。分数是启发式或模型推断，不是成功概率。
3. **Base 调研**：工作所在地、公开组织/公司、教育、任职、融资轮次/金额/投资方。GitHub 用户资料里的 `location` 和 `company` 会直接显示；网页检索到的教育、任职、融资需有原文引用。缺材料保持未知。

## 研究模型

默认接口：

- Provider: `deepseek`
- Base URL: `https://api.deepseek.com`
- Chat completions URL: `https://api.deepseek.com/chat/completions`
- Model: `deepseek-v4-pro`
- Headers: `Authorization: Bearer <RESEARCH_LLM_API_KEY>`
- DeepSeek thinking: `thinking.type=enabled`、`reasoning_effort=high`
- `stream: false`
- DeepSeek 请求默认最多等待 10 分钟；`RESEARCH_LLM_TIMEOUT_MS` 可设置 1000–1800000 毫秒。整次请求超时后不自动重复提交，短暂连接故障仍重试一次。

`.env` 中填 `RESEARCH_LLM_API_KEY`，`RESEARCH_LLM_BASE_URL=https://api.deepseek.com` 会自动拼成 `/chat/completions`；也可以直接设置完整的 `RESEARCH_LLM_URL`。如需回到旧蚂蚁内网通道，显式设置 `RESEARCH_LLM_PROVIDER=antchat` 和 `ANTCHAT_API_KEY`。配置 `TAVILY_API_KEY` 后额外检索团队背景、融资与产品公开网页。未配置检索时仍分析库内证据和 GitHub 公开资料，报告会标明缺少外部检索。

GitHub 每次补充最多 300 个名单和 30 份公开 profile，进度缓存；下一次点击继续补尚未取得的成员。贡献者不等于全体员工。

服务端检查来源 URL 和逐字引用确实存在于输入；没有证据的高分、人物、融资会被丢弃或改为未知。这不是事实核验，报告始终标记为推断/部分完成。
