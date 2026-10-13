apiVersion: v1
kind: Secret
metadata:
  name: oidc-trusted-ca
  namespace: kube-system
type: Opaque
data:
  ca.crt: ${CA_B64}
