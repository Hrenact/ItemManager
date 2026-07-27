<p align="center">
  <img src="image/Icon.png" alt="Item Manager 图标" width="128">
</p>

# Item Manager

Item Manager 是一个运行在 Windows 上的本地资源库管理工具，可用于整理下载的模型、素材和其他商品文件。应用支持封面、作者、标签、备注、网页地址和本地目录等信息，并可接管 `booth-library-manager://` 链接，直接下载 BOOTH 商品文件并建立条目。

所有条目和设置均保存在本机，不需要登录或连接云端服务。

## 下载与安装

### 下载便携版

1. 前往项目的 [Releases](https://github.com/Hrenact/ItemManager/releases) 页面。
2. 下载最新版本的 `Item Manager-<版本号>-win.zip`。
3. 将压缩包完整解压到一个有写入权限的目录。
4. 运行解压目录中的 `Item Manager.exe`。

这是便携版应用，不需要安装。请不要只把 `Item Manager.exe` 单独复制出来运行；Electron 运行库和其他资源文件也必须保留在原目录结构中。

如果 Releases 页面暂时没有可下载版本，可以按照文末的“二次开发”说明从源码构建。

### 数据存放位置

首次启动时，应用会在 `Item Manager.exe` 旁创建 `data` 文件夹。条目、标签、设置、封面缓存和 Electron 配置均保存在这里，现有数据不会在再次启动时被默认数据覆盖。

迁移或备份应用时，建议直接复制整个解压目录。至少应备份以下内容：

- `data/items.json`：条目数据
- `data/tags.json`：标签数据
- `data/settings.json`：应用设置
- `data/` 下的封面及其他运行数据

## 基本使用

### 创建条目

你可以通过以下方式来快速创建条目：

| 方式 | 行为 |
| -- | -- |
| `新建条目` 按钮 | 打开 `新建条目` 窗口，需手动填写相关信息 |
| `导入` 按钮 | 打开 `文件夹选择` 窗口，读取文件夹内的第一层目录并自动创建条目和填写 **本地路径** |
| `拖拽` 文件夹或文件至软件窗口 | 打开 `新建条目` 窗口，并自动填写 **本地路径** |
| Booth `DL with Booth Library Manager` | 见下方 **通过 BOOTH 下载文件** |

### 编辑条目

点击现有条目卡即可二次编辑条目。每个条目均可填写以下信息：

- 标题 + 作者
- 商品的网页链接
- 本地保存的文件/文件夹路径
- 封面图片
- 适用的标签和备注

条目的 `本地路径` 建议填写资源所在文件夹，而不是具体文件。这样即使同一商品包含多个压缩包或附件，也能从同一个条目打开完整目录。

若 `网页链接` 或 `本地路径` 填写的链接/路径符合 Booth 相关规范，即可触发软件的自动导入其余项目窗口。以下格式可以触发询问窗口：

- 网页链接
```text
https://booth.pm/语言/items/商品编号
https://子域名.booth.pm/items/商品编号

例：
https://booth.pm/zh-cn/items/6306337
https://hrenact.booth.pm/items/6306337
```

- 本地路径
```text
D:\Booth\b + 商品编号

例：
D:\Booth\b6306337
```

### 新建标签

当拥有大量条目时，标签可以辅助进行条目分类。点击 `新建/编辑标签` 按钮即可打开窗口。

- 若标签数量为零，填写 `标签名称` 后点击 `保存` 按钮即可新建标签
- 若已有标签，请点击标签列表下方的 `新建标签` 按钮来新建，直接编辑为修改标签列表第一个标签的属性

### 编辑标签

你可以修改标签的以下属性：

- 标签名称
- 背景、文字、边框颜色
- 在左侧的标签列表对标签进行拖拽排序

颜色功能在拥有大量标签时十分有用。点击 `预览色块 `即可打开 `调色盘`，你也可以通过 `取色` 按钮来吸取屏幕上的颜色。以下是配色示范：

```text
VRChat
background: #FFFFFF
text: #000000
border: #000000

Booth
background: #FB4D50
text: #FFFFFF
border: #e23a3d
```

你可以点击右下角的 `随机` 按钮来随机选取配色，也可以点击 `默认` 按钮来恢复初始配色。

### 软件设置

点击左下角的“设置”按钮，可以配置：

- **关联 URL 快捷方式**：让本应用处理 `booth-library-manager://` 链接。
- **文件下载保存目录**：所有 BOOTH 下载内容使用的统一根目录。
- **允许打开 DevTools**：启用后可使用 `F12` 或 `Ctrl + Shift + I` 打开开发者工具。

设置下载根目录时，请选择长期可用且当前用户有写入权限的目录，例如：

```text
C:\Users\<用户名>\Downloads\BOOTH
```

## 通过 BOOTH 下载文件

### 首次配置

1. 打开应用左下角的 `设置`。
2. 填写或选择 `文件下载保存目录`
3. 勾选 `将该应用关联 URL 快捷方式 booth-library-manager://`
4. 保存设置，并重新打开一次应用以确认关联仍然生效。

之后在 [Booth 库存页面](https://accounts.booth.pm/library) 内选择 `Other Downloads` > `DL with Booth Library Manager` 选项，即可唤醒 Item Manager 并触发下载任务。

也可以使用以下不包含下载任务的链接测试应用能否被唤醒：

```text
booth-library-manager://ItemManager/OpenApp
```

如果从未设置下载根目录，应用会拒绝下载，并提示先完成目录设置。

### 保存目录

每个 BOOTH 商品都会在下载根目录下使用独立文件夹，名称为 `b + item_id`。例如商品编号为 `6306337` 时，文件保存在：

```text
<下载根目录>\b6306337\
```

同一商品的多个文件会保存在同一个文件夹中。条目记录的本地路径也指向这个文件夹，而不是其中某个具体文件。

如果目标文件名已经存在，应用不会覆盖原文件，而是依次添加编号：

```text
asset.zip
asset (1).zip
asset (2).zip
```

过长的文件名会在界面中以省略号显示；保存时也会在保留扩展名的前提下处理为适合 Windows 路径的安全长度。

### 下载文件

进行下载时，软件左侧会显示 `下载` 列表，其中包括 `文件名`、`下载进度` 和 `下载速度`。服务器没有返回文件总大小时，进度条会以不确定状态显示，但仍会继续下载。

下载任务可以随时取消。下载中的内容先写入隐藏的 `.part` 临时文件；取消或下载失败后，应用会关闭文件句柄并自动清理未完成文件。下载完成后临时文件才会改为最终文件名。

下载成功后，应用会新建条目和尝试从 BOOTH 商品页获取并填写：

- 商品标题
- 店铺名称
- 商品封面
- 商品网页地址
- 对应的本地路径

如果商品信息抓取失败，已经下载完成的文件不会被删除，应用会使用文件名等已有信息建立基础条目。

如果资源库中已经存在相同商品编号的条目，下载文件仍会保留，但不会创建重复条目，并提示 `已存在相同条目，跳过创建`。

## 注意事项与常见问题

### URL 关联被其他应用抢占

`booth-library-manager://` 也由 BOOTH Library Manager 程序注册。Windows 对同一协议通常只保留一个当前处理程序，因此最后完成注册的应用可能会覆盖之前的关联。

Item Manager 只有在便携版中且设置项已勾选时才会注册该协议，并会在每次启动时重新确认关联。若链接再次打开了其他应用，请先关闭其他相关程序，再启动 Item Manager；必要时取消勾选、保存，然后重新勾选并保存。

开发模式不会注册或覆盖系统协议，避免调试时把链接错误地指向 `node_modules\electron\dist\electron.exe`。

### 链接过期或下载中断

BOOTH 下载地址通常是带签名且有有效期的临时链接。链接过期时，服务器一般会返回 `403` 等 HTTP 错误，此时需要从 BOOTH 获取新的下载链接。

无论是主动取消还是下载失败，应用都会尝试删除 `.part` 临时文件。如果目录正被杀毒软件、压缩工具或其他程序占用，清理可能稍有延迟。

### 其他注意事项

- 应用只接受 HTTPS 的 BOOTH 下载地址，并会检查重定向目标。
- 下载根目录被移动、删除或失去写入权限后，需要在设置中重新选择。
- 不要在下载过程中移动应用目录或下载根目录。
- `data` 文件夹包含个人资源库信息，分享应用压缩包前请先检查并移除自己的数据。
- DevTools 默认关闭。普通使用时建议保持关闭，仅在排查问题或二次开发时启用。
- 直接运行 `npm start` 只能使用浏览器界面；系统协议唤醒和集成下载需要 Electron 桌面版。

## 二次开发

### 环境要求

- Windows 10 或 Windows 11
- 当前 Node.js LTS 版本
- npm
- Git

克隆源码并安装依赖：

```powershell
git clone https://github.com/Hrenact/ItemManager.git
cd ItemManager
npm install
```

启动 Electron 开发版：

```powershell
npm run electron
```

仅启动本地网页服务：

```powershell
npm start
```

服务会在终端打印一个仅监听 `127.0.0.1` 的本地地址。浏览器模式适合调试界面和本地 API，但不提供完整的 Electron 协议处理能力。

### 项目结构

```text
electron-main.js     Electron 生命周期、协议注册和文件下载
preload.js           渲染进程可使用的受限 IPC 接口
server.js            本地 HTTP API、JSON 存储和 BOOTH 信息抓取
public/index.html    主界面结构
public/app.js        前端交互逻辑
public/styles.css    界面样式
data/                默认数据及开发环境数据
image/               应用图片资源
build/               Windows 图标和打包钩子
tests/               item-import 冒烟测试辅助脚本
```

### 构建 Windows 便携版

```powershell
npm run dist
```

构建会先清理旧的 `release` 目录，然后生成：

```text
release\win-unpacked\Item Manager.exe
release\Item Manager-<版本号>-win.zip
```

协议关联必须使用打包后的 `Item Manager.exe` 进行验证。开发环境中的 Electron 可执行文件只是运行容器，不应成为正式的协议处理程序。

修改代码后，建议至少完成以下检查：

1. 执行 `npm run dist`，确认 Windows 目录版和 ZIP 均能生成。
2. 启动 `release\win-unpacked\Item Manager.exe`，确认主界面可以打开。
3. 检查新增、编辑、标签、设置和本地路径等基本功能。
4. 使用 `booth-library-manager://ItemManager/OpenApp` 验证协议唤醒。
5. 使用测试链接验证正常下载、取消、重复文件名、重复条目和失败清理。

项目当前标记为 `UNLICENSED`。分发修改版或将代码用于其他项目之前，请先确认已获得相应授权。
