# =============================================================================
# K8S Ingress 配置(方案 A)
#
# 前端在子目录 /agentui/,API 走根路径 /api/*
# 两条路径都路由到同一个 Service(agentui),由 Pod 内 Nginx 统一分发。
#
# 前置条件:
#   1. 已部署 ingress-nginx 控制器
#   2. TLS 证书已通过 Secret 或 cert-manager 配置
#
# 使用:
#   kubectl apply -f deploy/subpath/k8s-ingress.yaml
# =============================================================================

apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: agentui-ingress
  namespace: default
  annotations:
    # ingress-nginx 配置
    kubernetes.io/ingress.class: nginx
    # 透传原始 Host 和前缀给后端(可选,后端可据此推断外部 URL)
    nginx.ingress.kubernetes.io/proxy-body-size: "1024m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    # SSE 长连接支持(关闭缓冲)
    nginx.ingress.kubernetes.io/server-snippet: |
      location ~* /api/v1/wargame/events {
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 0;
        proxy_send_timeout 0;
      }
    # cert-manager 自动签发证书(可选)
    # cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - example.com
      secretName: agentui-tls
  rules:
    - host: example.com
      http:
        paths:
          # 前端 SPA 子目录
          - path: /agentui
            pathType: Prefix
            backend:
              service:
                name: agentui
                port:
                  number: 80
          # API 路由(根路径,与前端子目录解耦)
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: agentui
                port:
                  number: 80
          # intellect-rag 直接暴露的 /v1/* (如需)
          - path: /v1
            pathType: Prefix
            backend:
              service:
                name: agentui
                port:
                  number: 80
