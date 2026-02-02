# Python Environment Manager

为 SenWeaver IDE 提供 Python 虚拟环境的自动检测和管理功能。

## 功能

- **自动检测虚拟环境**：自动发现工作区内的 `.venv`、`venv`、`.env`、`env` 等虚拟环境
- **支持多种环境类型**：
  - 标准虚拟环境 (venv)
  - Conda 环境
  - Poetry 环境
  - Pipenv 环境
  - pyenv 环境
  - 系统 Python
- **状态栏显示**：在状态栏显示当前选择的 Python 解释器
- **快速切换**：通过命令面板或状态栏快速切换 Python 解释器
- **与 basedpyright 集成**：自动配置 basedpyright 使用正确的 Python 路径

## 命令

- `Python: Select Interpreter` - 选择 Python 解释器
- `Python: Refresh Environments` - 刷新环境列表
- `Python: Create Virtual Environment` - 创建新的虚拟环境

## 配置

| 设置 | 描述 | 默认值 |
|------|------|--------|
| `python.defaultInterpreterPath` | 默认 Python 解释器路径 | `python` |
| `python.venvPath` | 虚拟环境目录路径 | `""` |
| `python.venvFolders` | 要搜索的虚拟环境文件夹名称 | `[".venv", "venv", ".env", "env"]` |
| `python.condaPath` | Conda 可执行文件路径 | `""` |
| `python.autoDetectVirtualEnvs` | 是否自动检测虚拟环境 | `true` |

## 与 basedpyright 配合使用

此扩展提供了与 `ms-python.python` 兼容的 API，使 basedpyright 能够：

1. 获取当前选择的 Python 解释器路径
2. 监听解释器变化事件
3. 正确解析虚拟环境中的第三方库

### 配置示例

```json
{
    "python.defaultInterpreterPath": "${workspaceFolder}/.venv/Scripts/python.exe",
    "python.venvPath": "C:/Users/username/.virtualenvs",
    "basedpyright.analysis.extraPaths": [
        "${workspaceFolder}/src"
    ]
}
```

## 故障排除

### 虚拟环境未被检测到

1. 确保虚拟环境目录名称在 `python.venvFolders` 配置中
2. 运行 `Python: Refresh Environments` 命令
3. 检查虚拟环境是否包含有效的 Python 可执行文件

### basedpyright 无法找到第三方库

1. 确保已选择正确的 Python 解释器
2. 检查 `python.pythonPath` 设置是否正确
3. 尝试重启语言服务器：`basedpyright: Restart Server`

