# Jenkins CI agent: node20 + JRE17(inbound-agent) + git
# 供华为集群静态 agent Pod(workspace=emptyDir 本地盘)使用,见 agentui deploy/cluster-rollout.md §5.5
FROM docker.1ms.run/library/node:20 AS node
FROM docker.1ms.run/library/eclipse-temurin:17-jre-jammy

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl bash ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && ln -fs /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && useradd -m -u 1000 jenkins

# CI 环境固化:时区(日期用例按 UTC+8 断言)/npm 本地缓存/堆上限
ENV LANG=C.UTF-8 TZ=Asia/Shanghai npm_config_cache=/tmp/npm-cache NODE_OPTIONS=--max-old-space-size=2048

USER 1000
WORKDIR /home/jenkins
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
