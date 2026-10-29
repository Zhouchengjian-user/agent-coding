# Agent coding

Agent coding 是一个面向企业与开发团队的 AI coding platform。它保留成熟编辑器的文件、编辑、终端、Git 和扩展能力，并把多模型 Agent 作为右侧常驻工作区。

## 第一版已经包含

- 独立产品名称与应用标识：`Agent coding`
- 右侧 Agent 工作台，首次启动自动打开
- Agent 的项目读取、搜索、文件编辑和命令执行能力
- DeepSeek、OpenAI、Anthropic、Google Gemini、OpenRouter
- 自定义 OpenAI 兼容接口
- 模型切换、流式回答、工具执行过程、停止任务、新建会话
- 对命令执行和文件修改的人工确认
- API Key 存入编辑器安全存储，不写入普通设置文件
- 自动读取当前工作区、当前文件和选中的代码

## 本地启动

项目使用仓库根目录 `.nvmrc` 指定的 Node.js 版本。

```bash
npm install
npm run watch
./scripts/code.sh
```

首次完整安装和编译会比较久。`npm install` 会自动安装内置 Agent 的运行依赖。

完成首次构建后，可以跳过预检查快速重启：

```bash
VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh
```

启动后，Agent 工作台位于右侧边栏。选择模型服务商和模型，点击 `API Key` 保存密钥，然后就可以让它读取或修改当前项目。

## 模型配置

内置服务商直接选择即可：

- DeepSeek：默认 `deepseek-v4-pro`
- OpenAI
- Anthropic
- Google Gemini
- OpenRouter

自定义服务需要在设置中填写：

```json
{
	"piAgent.provider": "custom",
	"piAgent.model": "your-model-id",
	"piAgent.baseUrl": "https://your-endpoint.example/v1"
}
```

然后在 Agent 工作台中保存该服务的 API Key。

## 安全边界

Agent 可以直接执行只读操作，例如读取、搜索和列出文件。运行命令、编辑文件和写入文件默认需要用户确认。可通过 `piAgent.requireApproval` 调整，但产品版本建议保持开启。

## 当前范围

这是可继续开发的桌面端源码。正式对外发布前还需要完成自动更新、账号与计费、隐私条款、崩溃上报、安装包签名，以及 Windows/macOS/Linux 的完整回归测试。

## 目录

- `extensions/pi-agent`：Agent 工作台内置扩展
- `product.json`：Agent coding 产品标识
- `build/npm/dirs.ts`：让主项目安装流程包含 Agent 运行依赖

