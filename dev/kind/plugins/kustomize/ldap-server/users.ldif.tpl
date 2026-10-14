version: 1

dn: ou=groups,dc=sighup,dc=io
objectClass: top
objectClass: organizationalUnit
ou: groups

dn: ou=people,dc=sighup,dc=io
objectClass: top
objectClass: organizationalUnit
ou: people

dn: cn=alice,ou=people,dc=sighup,dc=io
objectClass: top
objectClass: person
objectClass: inetOrgPerson
cn: alice
sn: Anderson
mail: alice@sighup.io
displayName: "Alice Anderson"
userPassword: alice

dn: cn=bob,ou=people,dc=sighup,dc=io
objectClass: top
objectClass: person
objectClass: inetOrgPerson
cn: bob
sn: Brown
mail: bob@sighup.io
displayName: "Bob Brown"
userPassword: bob

dn: cn=carol,ou=people,dc=sighup,dc=io
objectClass: top
objectClass: person
objectClass: inetOrgPerson
cn: carol
sn: Clark
mail: carol@sighup.io
displayName: "Carol Clark"
userPassword: carol

dn: cn=${SD_LDAP_GROUP},ou=groups,dc=sighup,dc=io
objectClass: top
objectClass: groupOfNames
cn: ${SD_LDAP_GROUP}
member: cn=alice,ou=people,dc=sighup,dc=io
member: cn=bob,ou=people,dc=sighup,dc=io
member: cn=carol,ou=people,dc=sighup,dc=io
