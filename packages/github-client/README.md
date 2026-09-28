# GitHub client

This package configures authenticated GitHub REST and GraphQL requests with the
repository's shared API version, media type, timeout, and retry behavior.
It also creates installation tokens from GitHub App credentials through
Octokit's application authentication flow.

Applications remain responsible for credential storage and deciding which
GitHub resources to read or change.
