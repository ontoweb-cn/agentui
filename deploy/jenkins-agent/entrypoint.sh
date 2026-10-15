#!/bin/sh
set -e
: "${JENKINS_URL:?JENKINS_URL required}"
: "${JENKINS_AGENT_NAME:?JENKINS_AGENT_NAME required}"
: "${JENKINS_SECRET:?JENKINS_SECRET required}"
WORK=/home/jenkins/agent
mkdir -p "$WORK"
cd "$WORK"
if [ ! -f agent.jar ]; then
  echo "[agent] fetching agent.jar from controller"
  curl -fsSL "$JENKINS_URL/jnlpJars/agent.jar" -o agent.jar
fi
echo "[agent] connecting: $JENKINS_URL computer=$JENKINS_AGENT_NAME"
exec java -jar agent.jar -jnlpUrl "$JENKINS_URL/computer/$JENKINS_AGENT_NAME/slave-agent.jnlp" \
  -secret "$JENKINS_SECRET" -workDir "$WORK"
