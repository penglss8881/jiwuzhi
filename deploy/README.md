# Linux 服务器部署

这套配置使用 Docker Compose 运行 MySQL、Express API、Nginx 静态站点和 Caddy 网关。域名已解析到服务器时，Caddy 会自动申请和续期 HTTPS 证书。MySQL、上传文件和证书均保存在 Docker 卷中，重新构建容器不会丢失。

## 1. 准备服务器

- 推荐 Ubuntu 24.04 LTS 或同类 Linux，至少 2 GB 内存。
- 安全组/防火墙开放 TCP 22、80、443；不要向公网开放 3001 和 3306。
- 按 Docker 官方文档安装 Docker Engine 与 Compose 插件。
- 有域名时，先把域名的 A/AAAA 记录指向服务器公网 IP。

## 2. 上传项目并配置密钥

把 `Library management` 整个目录传到服务器，例如 `/opt/jiwuzhi`，然后执行：

```bash
cd /opt/jiwuzhi
cp .env.production.example .env.production
nano .env.production
```

必须替换文件中所有 `CHANGE_ME`。可以用下面的命令分别生成数据库密码和应用密钥：

```bash
openssl rand -base64 32
openssl rand -hex 32
```

有域名时让 `SITE_ADDRESS=books.example.com`，同时让 `APP_ORIGIN=https://books.example.com`。只有 IP 时，两者都写成 `http://服务器IP`。

启动前先让 Compose 展开并校验配置：

```bash
docker compose --env-file .env.production config --quiet
```

## 3. 首次启动

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 db-init api gateway
```

首次启动会在空数据库中创建表和 `.env.production` 指定的管理员。若数据库已有 `users` 表，引导程序会跳过建表，绝不会删除或覆盖现有数据。打开 `SITE_ADDRESS` 登录后，立即确认管理员密码可用。

## 4. 迁移现有本机数据（可选）

先在原机器导出；请把 `plssss` 替换为真实数据库名：

```bash
mysqldump -u root -p --single-transaction --routines --triggers --default-character-set=utf8mb4 plssss > backup.sql
```

把 `backup.sql` 上传到项目目录。为了避免写入冲突，先停应用，导入后再启动：

```bash
docker compose --env-file .env.production stop gateway web api
docker compose --env-file .env.production exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < backup.sql
docker compose --env-file .env.production up -d
```

同时把原项目的 `uploads` 目录复制到上传卷。先查询卷挂载点，再复制文件：

```bash
docker volume inspect jiwuzhi_uploads
```

实际卷名前缀由项目目录名决定，可先运行 `docker volume ls` 确认。复制前停止 `api`，复制后确保容器内 `/app/uploads` 对运行用户可写。

## 5. 验证与日常维护

```bash
curl -fsS https://books.example.com/api/health
docker compose --env-file .env.production logs -f --tail=100
docker compose --env-file .env.production pull
docker compose --env-file .env.production up -d --build
```

至少每日备份 MySQL 和上传卷。升级前先备份；不要运行 `config/init-db.js`，该脚本会删除并重建业务表。不要提交 `.env.production`，也不要随意更换 `SECRET_KEY`。

## 6. 常见问题

- HTTPS 申请失败：确认域名已经解析到本机、80/443 未被其他程序占用，并查看 `gateway` 日志。
- API 启动失败：检查 `db` 是否健康，以及 `DB_NAME`、`DB_USER`、`DB_PASSWORD` 是否一致。
- 浏览器提示跨域：`APP_ORIGIN` 必须与地址栏中的协议和域名完全一致；多个来源可用英文逗号分隔。
- 页面刷新出现 404：当前 Nginx 配置已包含 Vue Router 的 SPA 回退；确认访问流量经过 `gateway`/`web`，不要直接运行 Vite preview。
