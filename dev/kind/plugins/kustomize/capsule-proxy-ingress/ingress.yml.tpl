apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: capsule-proxy
  namespace: capsule-system
  annotations:
    cert-manager.io/cluster-issuer: kind-ca
    nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"
    nginx.ingress.kubernetes.io/ssl-passthrough: "false"
spec:
  ingressClassName: nginx
  rules:
    - host: api.${NIP_DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: capsule-proxy
                port:
                  number: 9001
  tls:
    - hosts:
        - api.${NIP_DOMAIN}
      secretName: capsule-proxy-ingress-tls
