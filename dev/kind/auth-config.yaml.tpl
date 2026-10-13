apiVersion: apiserver.config.k8s.io/v1
kind: AuthenticationConfiguration
jwt:
- issuer:
    url: https://login.${NIP_DOMAIN}
    audiences:
    - pomerium
    - oidc-auth-client
    audienceMatchPolicy: MatchAny
    certificateAuthority: |
${CA_PEM_INDENTED}
  claimMappings:
    username:
      claim: email
      prefix: ""
    groups:
      claim: groups
      prefix: ""
