apiVersion: ctlptl.dev/v1alpha1
kind: Registry
name: ${KIND_CLUSTER_NAME}-registry
port: 5000
---
apiVersion: ctlptl.dev/v1alpha1
kind: Cluster
product: kind
registry: ${KIND_CLUSTER_NAME}-registry
kubernetesVersion: v1.36.4
kindV1Alpha4Cluster:
  name: ${KIND_CLUSTER_NAME}
  networking:
    disableDefaultCNI: true
  nodes:
  - role: control-plane
    kubeadmConfigPatches:
    - |
      kind: ClusterConfiguration
      apiServer:
        extraArgs:
          authentication-config: /etc/kubernetes/auth-config.yaml
        extraVolumes:
        - name: auth-config
          hostPath: /etc/kubernetes/auth-config.yaml
          mountPath: /etc/kubernetes/auth-config.yaml
          readOnly: true
    extraMounts:
    - hostPath: ${KIND_STATE_DIR}/auth-config.yaml
      containerPath: /etc/kubernetes/auth-config.yaml
      readOnly: true
  - role: worker
    extraPortMappings:
    - containerPort: 31080
      hostPort: 80
      listenAddress: "0.0.0.0"
      protocol: TCP
    - containerPort: 31443
      hostPort: 443
      listenAddress: "0.0.0.0"
      protocol: TCP
  - role: worker
  - role: worker
