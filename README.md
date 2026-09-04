# PrivNote

本地 Markdown 知识管理工具（Windows 桌面应用，Tauri 2 + React + TypeScript + Rust）。

把你的学习笔记当作**磁盘上真实的 Markdown 文件**来管理：选择一个文件夹作为「笔记库（Vault）」，
左侧目录树就是文件夹本身，每篇笔记就是一个 `.md` 文件，随时可以用任何编辑器打开。

## 功能

- **真实文件夹笔记库**：首次启动选择/创建笔记库，自动记忆，随时可切换；适合用 OneDrive 等同步盘随身携带
- **左侧目录树**：新建笔记 / 新建文件夹 / 重命名 / 移入回收站 / 导入现有 `.md`（多选）/ 在资源管理器中显示
- **标签页多开**：多篇笔记并排切换，带未保存圆点与保存状态
- **两种编辑模式（一键切换）**：
  - **写作**：所见即所得（Milkdown），工具栏按钮控制 标题/加粗/斜体/删除线/行内代码/代码块/引用/列表/分割线/表格/链接/图片 等样式；也支持直接输入 Markdown 语法（`#`、`**`、`> `…）即时生效
  - **源码**：直接编辑 Markdown 原文
- **自动保存**：编辑停顿即落盘（也可 Ctrl+S 立即保存），关闭窗口前自动冲刷
- **图片**：粘贴 / 拖入 / 按钮选择，自动存入笔记库 `assets/` 并以相对路径引用（图片对其它工具可见）
- **全文搜索**：按文件名 + 内容关键词实时搜索，命中行高亮，点击跳转
- **双链**：写作模式输入 `[[笔记标题]]` 自动高亮，点击跳转（不存在时一键创建）；右侧面板显示「引用出去 / 反向链接」
- **简体中文界面**
- **AI 写作助手（DeepSeek / OpenAI 兼容）**：绑定自己的 API Key；对话面板可附上当前笔记提问，回答一键追加到笔记或另存为新笔记；「写一篇」可按主题直接生成整篇 Markdown 笔记

## 开发

```bash
# 安装依赖
npm install

# 以开发模式运行（需要 Rust 工具链 + WebView2）
npm run tauri dev
```

## 打包 Windows 安装包

```bash
npm run tauri build   # 产物在 src-tauri/target/release/bundle/nsis/PrivNote_0.1.0_x64-setup.exe
```

## 工程结构

```
src/                前端（React + TS + Vite）
  components/       界面组件（目录树/标签页/编辑器/双链面板…）
  lib/editor/       Milkdown WYSIWYG 封装（工具栏命令/图片/双链装饰）
  store.ts          zustand 全局状态（含自动保存流水线）
src-tauri/          Rust 后端
  src/vault.rs      文件系统能力：目录树/CRUD/导入/图片/搜索/反向链接
  src/commands.rs   Tauri 命令层
  src/protocol.rs   privnote:// 自定义协议（预览库内图片）
scripts/icon-gen.ps1  书本图标生成脚本（System.Drawing，纯 ASCII）
```

## AI 助手配置

1. 打开应用后点击顶栏 ✨（或 AI 面板里的 ⚙）进入 AI 设置
2. 填入你自己的 **API Key**（默认发送到 DeepSeek 官方 `https://api.deepseek.com`）
3. Base URL / 模型名都可改，兼容任意 OpenAI 风格服务；想用 `deepseek-v4-flash` 等模型直接把“模型名”改成对应名称
4. Key 保存在本机应用配置 `config.json`，请求由 Rust 后端直接发出，Key 不暴露给前端页面

## 数据说明

- 笔记即文件，无私有数据库；笔记库目录结构 = 左侧树结构
- 粘贴/导入的图片统一放在笔记库根目录 `assets/`，笔记里写入相对路径
- 应用配置（上次使用的笔记库）保存在系统应用配置目录 `config.json`
- 删除是**移入回收站**，可放心操作
