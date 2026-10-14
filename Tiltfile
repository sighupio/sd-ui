registry_url = 'localhost:5000/headlamp-sd:dev'

docker_build(
  ref=registry_url,
  context='.',
  dockerfile='Dockerfile',
  # Package the dist/main.js built on the host (`npm run build`) instead of compiling in Docker
  build_args={'PLUGINS_SOURCE': 'local'},
  only=['plugins/'],
  ignore=[
    'plugins/*/node_modules',
    'plugins/*/src',
    'plugins/*/.eslintcache',
    'plugins/*/tsconfig.json',
    'plugins/*/package-lock.json',
    'plugins/*/AGENTS.md',
    'plugins/*/README.md',
  ],
)

# Deploy Headlamp from the katalog in sighupio/module-utilities (single source of truth). The overlay is chosen by
# auto-detecting Capsule from dev/kind/furyctl.yaml (the file `up` applied) — the same
# signal startup.sh uses — so the dev loop follows whatever was installed:
#   Capsule present -> dev/kind/tilt/headlamp            (module-utilities examples/oidc-capsule -> Capsule Proxy)
#   no Capsule      -> dev/kind/tilt/headlamp-no-capsule (base -> real API server)
# Both use the Tilt-built image and the dev nip.io ingress host.
# Requires `mise run generate-templates` first (renders kustomization.yaml + patch-ingress-host.yaml).
_capsule = 'projectcapsule/capsule' in str(read_file('dev/kind/furyctl.yaml', default=''))
headlamp_overlay = 'dev/kind/tilt/headlamp' if _capsule else 'dev/kind/tilt/headlamp-no-capsule'
k8s_yaml(kustomize(headlamp_overlay))
k8s_resource('headlamp', labels=['headlamp'])
