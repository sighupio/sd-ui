# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Injects the dev nip.io host into the oidc-capsule example's Ingress.
# Rendered to patch-ingress-host.yaml by dev/kind/scripts/generate-templates.sh (envsubst).
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: headlamp
  namespace: pomerium
  annotations:
    cluster.kfd.sighup.io/useful-link.url: https://headlamp.${NIP_DOMAIN}
spec:
  rules:
    - host: headlamp.${NIP_DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: pomerium
                port:
                  number: 80
  tls:
    - hosts:
        - headlamp.${NIP_DOMAIN}
      secretName: headlamp-tls
