# Copyright (c) 2017-present SIGHUP s.r.l All rights reserved.
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file.

# Dev overlay for the Capsule-free scenario (CAPSULE=false). Deploys the ui module's
# Headlamp base (which runs in-cluster against the real API server) plus the
# oidc-rbac example's Pomerium ingress, adapted for the local dev cluster:
#   - image swapped to the Tilt-built image (localhost:5000/headlamp-sd:dev)
#   - ingress host injected via patch-ingress-host.yaml (generated from the .tpl)
#
# It deliberately does NOT pull in the oidc-rbac example's rbac.yaml: the RBAC is
# applied by the furyctl `oidc-rbac` plugin (bound to the sd-ui-users group), so
# pulling the example's RBAC here would double-apply it with a different group.
#
# The base is injected by generate-templates.sh from $SD_UI_KATALOG_BASE, which defaults to
# a remote kustomize reference to sighupio/module-utilities pinned to $SD_UI_MODULE_REF
# (set SD_UI_MODULE_PATH to use a local checkout instead).
# Consumed by the Tiltfile via kustomize() when CAPSULE=false.
---
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - ${SD_UI_KATALOG_BASE}
  - ingress.yaml

images:
  - name: registry.sighup.io/fury/sd-ui
    newName: localhost:5000/headlamp-sd
    newTag: dev

patches:
  - path: patch-ingress-host.yaml
