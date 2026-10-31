# Security policy

## Supported version

Only the latest release is supported. Update to it before reporting a problem.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. Please don't open a public issue for it. Include the version, what you did, and what
happened.

## Scope

The app runs a local web server that only serves its own computer (`127.0.0.1`); it isn't meant to be reachable from
other machines. A report that needs network access to that port from another computer is outside the supported setup.
