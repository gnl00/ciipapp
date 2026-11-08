# ciip 官网与GitHub Pages

## 仓库与站点地址

项目使用现有账号下的[gnl00/ciipapp](https://github.com/gnl00/ciipapp)仓库，GitHub Pages项目站点为[https://gnl00.github.io/ciipapp/](https://gnl00.github.io/ciipapp/)，已启用GitHub Actions部署。

[GitHub规则](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)：一个账号/组织最多一个用户/组织站点，每个仓库都可以有一个项目站点。

| 仓库 | 默认网址 |
| --- | --- |
| gnl00/gnl00.github.io | https://gnl00.github.io/ |
| gnl00/ciipapp | https://gnl00.github.io/ciipapp/ |
| ciipapp/ciipapp.github.io | https://ciipapp.github.io/ |

已有用户站点也可以使用ciipapp项目站点。ciipapp.github.io前缀由账号或组织名决定，不由任意仓库名决定。独立域名可以后续绑定。

## 本地开发

```sh
npm ci
npm run dev:website
npm run typecheck -w @ciip/website
npm run test:website
npm run build:website
npm run preview -w @ciip/website
```

官网源码在website/src，静态资源在website/public，产物在website/dist。TypeScript与Vite为开发依赖，不需要服务端；页面主要内容在HTML中，无JavaScript也可阅读。演示操作只改变本页示意画面，不读取屏幕或真实剪贴板。

## GitHub部署

1. 把项目代码上传到[gnl00/ciipapp](https://github.com/gnl00/ciipapp)，使用main分支。
2. 仓库Settings → Pages → Source选择GitHub Actions。
3. `.github/workflows/pages.yml`在main相关文件更新后构建并部署，也可手动触发。

工作流依据github.repository自动生成项目路径、源码地址和Releases地址；当前仓库注入`/ciipapp/`、`https://github.com/gnl00/ciipapp`及其`/releases/latest`地址。普通仓库会用`/仓库名/`，账号.github.io仓库使用`/`。这与[Vite的Pages配置](https://vite.dev/guide/static-deploy#github-pages)一致，避免图片/脚本在子路径404。

只上传website/dist，不上传桌面应用、frontend/dist、原型、安装器或本地QA。npm lockfile随源码提交，node_modules与生成的dist忽略。

## 链接与发布

官网集中读取环境配置：

| 变量 | 用途 |
| --- | --- |
| VITE_BASE_PATH | 静态资源基础路径，Pages自动注入 |
| VITE_REPOSITORY_URL | 源码URL，Pages从实际仓库注入；本地默认实际仓库地址 |
| VITE_RELEASE_URL | 最新版本说明与异常回退地址，默认实际仓库的/releases/latest；可选HTTPS覆盖 |

下载区提供Apple芯片（arm64）和Intel芯片（x86_64）两个DMG下载按钮。页面向GitHub公开API请求一次最新正式Release元数据，从其assets中按实际tag与架构匹配安装包；后续发版无需重新部署官网。按钮链接使用GitHub返回的真实附件地址，并核对仓库、tag和文件名，不写死某一版本。查询期间点击会等待同一次请求完成；请求失败、超时或禁用JavaScript时回到[最新版本页](https://github.com/gnl00/ciipapp/releases/latest)。元数据请求不使用认证信息，仍受GitHub公开API的可用性及访问额度限制。

版本发布由[release.yml](../.github/workflows/release.yml)处理：推送`v0.10.1`这类版本tag，Actions分别在Apple芯片和Intel原生runner构建arm64与x86_64包；两种架构全部成功并验证产物后才公开Release。每种架构提供DMG与ZIP，并附SHA256校验清单。版本同步、tag命令、签名和失败重跑说明见[RELEASING.md](RELEASING.md)。两种芯片的下载安装与系统功能仍需分别做实机验收。

不必设置Actions变量`CIIP_RELEASE_URL`。默认`/releases/latest`会跟随后续正式版本。只有改用其他公开版本说明或回退入口时才设置该HTTPS变量，再重新部署Pages。实际DMG地址仍从源码仓库的最新Release解析。`website/.env.example`提供本地覆盖示例。

后续若绑定自定义域名，在Pages中配置域名与DNS，并将Actions变量PAGES_BASE_PATH设为`/`。

原生截图权限、离线OCR与签名的说明以实际应用能力和发布页为准。当前双架构发布流程不等于两种芯片的实机验收，也不等于Apple公证；官网不使用虚构评分或用户数。
