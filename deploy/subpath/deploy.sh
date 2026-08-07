#!/bin/bash
# =============================================================================
# 子目录部署完整脚本(方案 A)
#
# 用法:
#   ./deploy/subpath/deploy.sh agentui example.com
#
# 参数:
#   $1 = SUBPATH(子目录名,默认 agentui)
#   $2 = INGRESS_HOST(域名,默认 example.com)
#
# 前置条件:
#   - 已安装 docker、kubectl
#   - 已配置 K8S kubeconfig
#   - 已部署 ingress-nginx
# =============================================================================

set -e

SUBPATH="${1:-agentui}"
INGRESS_HOST="${2:-example.com}"
IMAGE_TAG="agentui:subpath-${SUBPATH}"

echo "===== 1. 构建 Docker 镜像 ====="
echo "SUBPATH=${SUBPATH}"
echo "IMAGE=${IMAGE_TAG}"
docker build -f deploy/subpath/Dockerfile \
  --build-arg SUBPATH="${SUBPATH}" \
  -t "${IMAGE_TAG}" .

echo ""
echo "===== 2. 加载镜像到 K8S(minikube/kind 需此步;远程仓库可跳过) ====="
if command -v minikube >/dev/null 2>&1; then
  minikube image load "${IMAGE_TAG}"
elif command -v kind >/dev/null 2>&1; then
  kind load docker-image "${IMAGE_TAG}"
else
  echo "未检测到 minikube/kind,假设镜像已推送到远程仓库"
  # 实际生产应推送:docker push "${IMAGE_TAG}"
fi

echo ""
echo "===== 3. 创建 Secret(如不存在) ====="
kubectl create secret generic agentui-secrets \
  --from-literal=rag-admin-token="" \
  --from-literal=enterprise-api-key="" \
  --dry-run=client -o yaml | kubectl apply -f -

echo ""
echo "===== 4. 部署 Deployment + Service ====="
# 替换镜像名和域名后应用
sed -e "s|agentui:subpath|${IMAGE_TAG}|g" \
    deploy/subpath/k8s-deployment.yaml | \
  kubectl apply -f -

echo ""
echo "===== 5. 部署 Ingress ====="
sed "s|example.com|${INGRESS_HOST}|g" \
  deploy/subpath/k8s-ingress.yaml | \
  kubectl apply -f -

echo ""
echo "===== 部署完成 ====="
echo "访问: https://${INGRESS_HOST}/${SUBPATH}/"
echo ""
echo "验证:"
echo "  kubectl get pods -l app=agentui"
echo "  kubectl get ingress agentui-ingress"
echo "  curl -I https://${INGRESS_HOST}/${SUBPATH}/"
