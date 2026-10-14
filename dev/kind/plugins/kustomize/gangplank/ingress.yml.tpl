apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  labels:
    cluster.kfd.sighup.io/useful-link.enable: "true"
  annotations:
    cluster.kfd.sighup.io/useful-link.url: https://gangplank.${NIP_DOMAIN}
    cluster.kfd.sighup.io/useful-link.name: "Gangplank"
    forecastle.stakater.com/expose: "true"
    forecastle.stakater.com/appName: "Gangplank - SSO Kubeconfig"
    cert-manager.io/cluster-issuer: kind-ca
  name: gangplank
  namespace: kube-system
spec:
  ingressClassName: nginx
  rules:
    - host: gangplank.${NIP_DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: gangplank-svc
                port:
                  name: http
  tls:
    - hosts:
        - gangplank.${NIP_DOMAIN}
      secretName: gangplank-tls
